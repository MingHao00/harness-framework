#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shell_guard.py — beforeShellExecution Hook

职责：
  1. 极危命令（不可逆破坏性操作）→ deny，直接拦截
  2. 危险命令（可能有破坏性）→ ask，要求用户确认
  3. git commit 消息不符合约定式提交规范 → ask，提示修正
  4. 所有决策均写入审计日志（含命令 SHA-256 哈希）

修复记录（基于 Review/shell_guard_review.md）：
  F1  - 双前瞻断言分别检测 -r/-f 标志，覆盖 rm -r -f 分离参数绕过
  F2  - 路径锚点改为 (?:$|[|;&\\n])，覆盖命令链中的根目录删除
  F3  - 合并 Remove-Item 与别名 ri 为单条规则
  F4  - pip uninstall 中间段限制从 40 扩展到 120 字符
  F5  - git commit 中间标志段从 60 扩展到 120 字符
  F6  - 使用 finditer 校验命令链中所有 git commit 消息
  F7  - 异常处理路径同步写入审计日志
  F8  - 用户提示类型列表从 _CC_TYPES 统一生成，含 wip
  F9  - 移除冗余的 re.DOTALL 旗标
  F10 - _stdout_ask 迁移至 hook_utils.py，此处改为 import
  F11 - 日志截断从 400 增至 1000，新增 command_sha256 字段

第二轮修复（基于 Review/shell_guard_review.md 第二轮审阅）：
  N1  - git push --force 中间段从 60 扩展到 120，覆盖长分支名绕过
  N2  - git reset --hard 中间段从 40 扩展到 120，覆盖完整 refs 路径
  N3  - reconfigure() 移入 __main__ 并加防御性 try/except，避免测试框架兼容性问题

第三轮修复（基于 Review/shell_guard_review.md 第三轮审阅）：
  T1  - hook_utils.py 模块级 reconfigure() 提取为 configure_utf8_streams() 函数，
        N3 修复由双层冗余变为统一的函数调用
  T2  - except 子句从冗余的 (AttributeError, Exception) 精简为 (AttributeError, OSError)，
        OSError 覆盖 io.UnsupportedOperation
  T3  - 异常路径日志的 command 字段改用 "(unparsed)" 占位，原始 JSON 嵌入 reason，
        消除与正常路径 command_sha256 字段的语义歧义
  T4  - 添加 from __future__ import annotations，注解延迟求值，最低版本 Python 3.10
"""

from __future__ import annotations  # T4：延迟注解求值，最低版本 Python 3.10（X|Y 联合类型）

import hashlib
import json
import re
import sys
import traceback
from pathlib import Path

from hook_utils import (
    append_jsonl,
    configure_utf8_streams,
    stdout_allow,
    stdout_ask,
    stdout_deny,
    ts_utc,
)

LOG_FILE = Path(__file__).parent.parent / ".cursor" / "logs" / "shell_guard.log"

# 从 _CC_TYPES 统一生成用户可见的类型列表（F8）
_CC_TYPES = "feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert|wip"
_CC_TYPES_DISPLAY = " / ".join(_CC_TYPES.split("|"))

# ──────────────────────────────────────────────────────────────────────────────
# 极危规则：命中即 deny（不可逆、灾难性操作）
# ──────────────────────────────────────────────────────────────────────────────
# 每条规则格式：(正则模式, 操作描述)
DENY_RULES: list[tuple[str, str]] = [
    # Linux/Mac: rm 同时含 -r/--recursive 和 -f/--force，且目标为根/HOME（F1+F2）
    # 双前瞻断言确保两个标志独立匹配，路径后允许命令分隔符而非只允许行尾
    (
        r"\brm\b"
        r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*r[a-zA-Z]*\b|\s--recursive\b))"
        r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force\b))"
        r"[^|;&\n]{0,120}\s+"
        r"(\/\s*(?:$|[|;&\n])|~\s*(?:$|[|;&\n])|\/\*\s*(?:$|[|;&\n])"
        r"|\$HOME\s*(?:$|[|;&\n])|\$\{HOME\}\s*(?:$|[|;&\n]))",
        "递归删除根目录 / 或 HOME 目录",
    ),
    # Windows：格式化磁盘分区（format c: / format d:）
    (
        r"\bformat\s+[a-zA-Z]:|\bformat\s+\/",
        "格式化磁盘分区",
    ),
    # 覆写磁盘块设备（dd of=/dev/sdX）
    (
        r"\bdd\b.*\bof\s*=\s*\/dev\/(sd[a-z]|hd[a-z]|nvme\d+n\d+)\b",
        "覆写磁盘块设备",
    ),
    # Fork Bomb
    (
        r":\(\)\s*\{[^}]*:\s*\|[^}]*:\s*&[^}]*\}",
        "Fork Bomb（资源耗尽炸弹）",
    ),
    # 覆写系统关键认证文件
    (
        r">\s*(\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers)\b",
        "覆盖系统认证文件",
    ),
    # DROP DATABASE（不可逆删库）
    (
        r"\bDROP\s+DATABASE\b",
        "删除整个数据库（DROP DATABASE）",
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# 危险规则：命中 → ask（需用户确认）
# ──────────────────────────────────────────────────────────────────────────────
ASK_RULES: list[tuple[str, str]] = [
    # rm 含 -r/--recursive 且含 -f/--force，任意路径（F1：覆盖 rm -r -f 分离形式）
    (
        r"\brm\b"
        r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*r[a-zA-Z]*\b|\s--recursive\b))"
        r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force\b))",
        "递归强制删除（rm -rf）",
    ),
    # Windows：del 递归删除
    (
        r"\bdel\b[^|;&\n]{0,60}\/[sS]\b",
        "Windows 递归删除（del /s）",
    ),
    # Windows：rmdir 删除非空目录
    (
        r"\brmdir\b[^|;&\n]{0,60}\/[sS]\b",
        "Windows 删除非空目录（rmdir /s）",
    ),
    # PowerShell：Remove-Item 或别名 ri，含 -Recurse/-r（F3：合并规则）
    (
        r"\b(Remove-Item|ri)\b[^|;&\n]{0,80}(?:-Recurse\b|-r\b)",
        "PowerShell 递归删除（Remove-Item/ri -Recurse）",
    ),
    # SQL：删除数据表
    (
        r"\bDROP\s+TABLE\b",
        "删除数据表（DROP TABLE）",
    ),
    # SQL：清空数据表
    (
        r"\bTRUNCATE\s+TABLE\b|\bTRUNCATE\b(?!\s+DATABASE\b)",
        "清空数据表（TRUNCATE TABLE）",
    ),
    # chmod 777
    (
        r"\bchmod\s+(777|a\+rwx|ugo\+rwx)\b",
        "设置 777 全开权限（chmod 777）",
    ),
    # sudo rm
    (
        r"\bsudo\s+rm\b",
        "以 root 权限删除文件（sudo rm）",
    ),
    # sudo chmod
    (
        r"\bsudo\s+chmod\b",
        "以 root 权限修改文件权限（sudo chmod）",
    ),
    # git push --force / -f（N1：中间段从 60 扩展到 120，覆盖长分支名）
    (
        r"\bgit\s+push\b[^|;&\n]{0,120}(--force\b|-f\b)",
        "Git 强制推送（git push --force）",
    ),
    # git reset --hard（N2：中间段从 40 扩展到 120，覆盖完整 refs 路径）
    (
        r"\bgit\s+reset\b[^|;&\n]{0,120}--hard\b",
        "Git 硬重置，丢弃未提交更改（git reset --hard）",
    ),
    # git clean -f（-f 可与其他标志组合如 -fd）
    (
        r"\bgit\s+clean\b[^|;&\n]{0,40}-[^\s]*f",
        "Git 强制清理未追踪文件（git clean -f）",
    ),
    # git stash drop / clear
    (
        r"\bgit\s+stash\s+(drop|clear)\b",
        "删除 Git stash 记录",
    ),
    # pip uninstall -y（F4：中间段扩展至 120 字符）
    (
        r"\bpip\s+uninstall\b[^|;&\n]{0,120}-y\b",
        "批量卸载 Python 包（pip uninstall -y）",
    ),
    # npm global uninstall
    (
        r"\bnpm\s+uninstall\s+-g\b",
        "卸载全局 npm 包",
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# Conventional Commits 校验
# ──────────────────────────────────────────────────────────────────────────────
_CC_PATTERN = re.compile(
    r"^(" + _CC_TYPES + r")(\([^)]{1,40}\))?(!)?:\s+\S.{0,200}$",
    re.IGNORECASE,
)

# 匹配 git commit -m "msg"（F5：中间标志段从 60 扩展到 120）
# F9：移除 re.DOTALL（[^"]+ 和 [^']+ 已处理引号边界，无需跨行匹配）
_GIT_COMMIT_RE = re.compile(
    r'\bgit\s+commit\b(?:[^|;&\n]{0,120})'
    r'(?:-m\s+"([^"]+)"|-m\s+\'([^\']+)\'|--message\s*=\s*"([^"]+)"|--message\s*=\s*\'([^\']+)\')',
    re.IGNORECASE,
)

# ──────────────────────────────────────────────────────────────────────────────
# 预编译（F9：移除冗余的 re.DOTALL，仅保留 re.IGNORECASE）
# ──────────────────────────────────────────────────────────────────────────────
_deny_compiled = [(re.compile(p, re.IGNORECASE), desc) for p, desc in DENY_RULES]
_ask_compiled = [(re.compile(p, re.IGNORECASE), desc) for p, desc in ASK_RULES]


def _log(level: str, command: str, decision: str, reason: str = "") -> None:
    """写入审计日志（F11：截断提升至 1000 字符，新增 command_sha256）。"""
    entry = {
        "time": ts_utc(),
        "level": level,
        "decision": decision,
        "reason": reason,
        "command": command[:1000],
        "command_sha256": hashlib.sha256(
            command.encode("utf-8", errors="replace")
        ).hexdigest(),
    }
    try:
        append_jsonl(LOG_FILE, entry)
    except Exception as exc:
        sys.stderr.write(f"[shell_guard] 日志写入失败: {exc}\n")
        sys.stderr.flush()


def _check_git_commit_msg(command: str) -> tuple[str, str] | None:
    """
    校验命令链中所有 git commit 消息是否符合 Conventional Commits 规范（F6）。
    使用 finditer 遍历所有匹配，只要有一条不合规即返回警告。
    返回 (user_message, agent_message)，全部合规则返回 None。
    """
    for m in _GIT_COMMIT_RE.finditer(command):
        msg = next((g for g in m.groups() if g is not None), "").strip()
        if not msg or _CC_PATTERN.match(msg):
            continue
        user_msg = (
            f"[Shell Guard] git commit 消息不符合约定式提交（Conventional Commits）规范。\n\n"
            f"当前消息：\"{msg}\"\n\n"
            f"期望格式：<type>(<scope>): <简短描述（中文）>\n"
            f"示例：feat(auth): 添加用户登录功能\n"
            f"      fix(api): 修复分页参数越界问题\n\n"
            f"可用类型：{_CC_TYPES_DISPLAY}\n\n"  # F8：从 _CC_TYPES 统一生成，含 wip
            f"是否仍然继续提交？"
        )
        agent_msg = (
            f"[shell_guard] git commit message 不符合 Conventional Commits 规范，"
            f"已提请用户确认。当前消息: {repr(msg[:120])}"
        )
        return user_msg, agent_msg
    return None


def main(raw: str) -> None:
    if not raw.strip():
        stdout_allow()
        return

    try:
        data = json.loads(raw)
    except Exception:
        stdout_allow()
        return

    command: str = (data.get("command") or "").strip()
    if not command:
        stdout_allow()
        return

    # ── 第一步：极危命令检查（deny）─────────────────────────────────────────
    for pattern, desc in _deny_compiled:
        if pattern.search(command):
            _log("WARN", command, "deny", f"极危命令 - {desc}")
            stdout_deny(
                f"[Shell Guard] 命令已被拦截\n\n"
                f"原因：{desc}\n\n"
                f"此操作具有不可逆的破坏性，已被自动拒绝。如确有必要，请在终端手动执行并做好备份。",
                f"[shell_guard] 极危命令被拒绝。规则: {desc}。命令摘要: {repr(command[:150])}",
            )
            return

    # ── 第二步：危险命令检查（ask）──────────────────────────────────────────
    for pattern, desc in _ask_compiled:
        if pattern.search(command):
            _log("INFO", command, "ask", f"危险命令 - {desc}")
            stdout_ask(  # F10：使用 hook_utils.stdout_ask
                f"[Shell Guard] 检测到危险操作，请确认\n\n"
                f"操作类型：{desc}\n"
                f"完整命令：{command[:300]}\n\n"
                f"请确认是否继续执行？建议先备份相关数据。",
                f"[shell_guard] 危险命令已暂停，等待用户确认。规则: {desc}。",
            )
            return

    # ── 第三步：git commit 消息格式校验（ask）──────────────────────────────
    warn = _check_git_commit_msg(command)
    if warn:
        user_msg, agent_msg = warn
        _log("INFO", command, "ask", "git commit 消息不符合约定式提交规范")
        stdout_ask(user_msg, agent_msg)
        return

    # ── 放行 ─────────────────────────────────────────────────────────────────
    _log("INFO", command, "allow")
    stdout_allow()


if __name__ == "__main__":
    # T1：使用 hook_utils.configure_utf8_streams() 统一处理编码设置。
    #     在读取 stdin 之前调用，确保 Windows GBK → UTF-8 转换正确。
    #     函数内部使用精准的 except (AttributeError, OSError)（T2）。
    configure_utf8_streams()

    _raw = sys.stdin.read()
    try:
        main(_raw)
    except Exception:
        tb = traceback.format_exc()
        sys.stderr.write(tb)
        sys.stderr.flush()
        # F7：异常时同步写入审计日志，保留可查记录；fail-open 不阻塞工作流
        # T3：command 字段用 "(unparsed)" 占位，原始 JSON 嵌入 reason，
        #     避免 command/command_sha256 字段在异常路径与正常路径语义不一致。
        try:
            _log("ERROR", "(unparsed)", "allow",
                 f"未处理异常: {tb[:300]} | raw_input: {_raw[:200]}")
        except Exception:
            pass
        stdout_allow()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sensitive_file_guard.py — preToolUse Hook

职责：
  1. 拦截 Agent 对敏感文件的读写/删除操作：
     - 读取敏感文件 → ask（提示用户确认，防止意外泄露）
     - 写入/删除敏感文件 → deny（直接阻断，防止配置被覆盖或污染）
  2. 敏感文件判定维度：
     - 环境变量文件：.env, .env.*, .envrc
     - 密钥/证书文件：*.pem, *.key, *.pfx, *.p12, *.keystore, *.jks, *.ppk, *.p8, *.asc
     - SSH 密钥：id_rsa, id_ed25519, id_ecdsa, id_dsa（及对应 *.pub 公钥）
     - 凭据文件名：credentials*, *secret*, *token*, .htpasswd, .pgpass, .netrc, .npmrc
     - 配置秘密文件：*.tfvars, .kubeconfig, kubeconfig
     - 云平台凭据：GCP 应用默认凭据 JSON、AWS credentials/config（~/.aws/ 下）
  3. 覆盖工具范围：Read（ask）/ Write / StrReplace / EditNotebook / Delete（deny）
  4. Shell 工具由 shell_guard.py 负责，本脚本不重复覆盖 Shell 命令
  5. 所有拦截决策均写入审计日志（JSONL 格式），日志超 10 MB 自动轮转

修复记录（基于 Review/sensitive_file_guard_review.md）：
  R1  - 异常路径改为 Fail-Safe：stdout_deny() 而非 stdout_allow()
  R2  - 添加 SSH 公钥规则 ^id_.*\\.pub$，消除文档承诺与实现的不一致
  R3  - secret/token 改用字母负向后瞻/前瞻 (?<![a-z])secrets?(?![a-z])，
        避免 \b 把 _ 视为词字符导致 _secrets.yml 边界失效，同时防止 secretariat/tokenize 误报
  R4  - 覆盖 Delete 工具（deny），hooks.json matcher 更新为 Read|Write|Delete
  R5  - 移除指向目录/二进制的 ^\\.aws$ 和 ^gcloud$ 规则；
        改为匹配实际凭据文件：credentials（已有）、application_default_credentials*.json
  R6  - 添加日志轮转：超过 _MAX_LOG_SIZE（10 MB）时备份为 .log.bak 再继续写入
  R7  - 统一截断长度常量：_PATH_LOG_LIMIT=500 / _PATH_MSG_LIMIT=200
  R8  - 类型注解完善：dict → dict[str, object]
  R9  - 补充敏感文件模式：*.tfvars、*.asc、.pgpass、.netrc、.npmrc、*.p8
  R10 - 修正 service.?account 正则：改为 service[_\\-]?account，消除任意字符匹配歧义

第二轮修复（基于 Review/sensitive_file_guard_review.md 第二轮审阅）：
  N1  - JSON 解析失败路径改为 Fail-Safe：stdout_deny() 而非 stdout_allow()，与 R1 原则一致
  N2  - 日志轮转备份文件名加入 UTC 时间戳，避免 .log.bak 被静默覆盖丢失历史日志
        注：竞态条件（TOCTOU）由 OSError 静默捕获兜底，轮转失败不阻断审计写入
  N3  - path 字段改用 isinstance 类型检查替代 str() 强转，防止列表等非法类型被静默转换
  N4  - 补充 docker-compose.override.yml 敏感模式（R9 遗漏项）

T1-T3 (user feedback round 3):
  T1  - hook_utils.py errors=replace -> surrogateescape: preserve raw bytes
        so CP936/GBK multi-byte chars in JSON are not corrupted to \ufffd
  T2  - tool_input explicit isinstance(dict) check; non-empty list bypasses
        `or {}` and triggers AttributeError on .get() without T2 fix
  T3  - added test_sensitive_file_guard.py: pattern matching, false-positive
        prevention, case insensitivity, main() I/O paths

第四轮修复：
  U1  - _extract_path_from_raw 调用时传入 str 而非 bytes，导致内部所有 .decode()
        抛 AttributeError 被静默吞掉，函数始终返回 ""，触发 Fail-Safe deny。
        修复：main() 中改为 raw.encode("utf-8", errors="replace") 再传入。
  U2  - hooks.json matcher 从 "Read|Write|Delete" 扩展为
        "Read|Write|StrReplace|EditNotebook|Delete"，与脚本 _WRITE_TOOLS 定义
        及文档注释保持一致，防止 Agent 通过 StrReplace/EditNotebook 绕过保护。
"""

from __future__ import annotations

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

LOG_FILE = Path(__file__).parent.parent / ".cursor" / "logs" / "sensitive_file_guard.log"

# R7：截断长度具名常量，统一日志字段与消息字段的截断行为
_PATH_LOG_LIMIT = 500
_PATH_MSG_LIMIT = 200

# R6：日志文件大小上限（超出后轮转为 .log.bak）
_MAX_LOG_SIZE = 10 * 1024 * 1024  # 10 MB

# ──────────────────────────────────────────────────────────────────────────────
# 敏感文件模式列表
# 每条规则格式：(正则模式, 描述)
# 匹配对象为文件名（basename），统一使用 IGNORECASE
# ──────────────────────────────────────────────────────────────────────────────
_SENSITIVE_PATTERNS: list[tuple[str, str]] = [
    # 环境变量文件
    (r"^\.env$",                             ".env 环境变量文件"),
    (r"^\.env\.",                            ".env.* 环境变量文件（如 .env.local）"),
    (r"^\.envrc$",                           ".envrc direnv 环境变量文件"),
    # PEM / 证书 / 私钥文件
    (r"\.pem$",                              "PEM 证书/私钥文件"),
    (r"\.key$",                              "私钥文件（*.key）"),
    (r"\.pfx$",                              "PKCS#12 证书文件（*.pfx）"),
    (r"\.p12$",                              "PKCS#12 证书文件（*.p12）"),
    (r"\.p8$",                               "Apple APNs 私钥文件（*.p8）"),  # R9
    (r"\.keystore$",                         "Java KeyStore 文件（*.keystore）"),
    (r"\.jks$",                              "Java KeyStore 文件（*.jks）"),
    (r"\.ppk$",                              "PuTTY 私钥文件（*.ppk）"),
    (r"\.asc$",                              "GPG 装甲密钥文件（*.asc）"),   # R9
    # SSH 私钥（标准命名）
    (r"^id_rsa$",                            "SSH RSA 私钥"),
    (r"^id_ed25519$",                        "SSH ED25519 私钥"),
    (r"^id_ecdsa$",                          "SSH ECDSA 私钥"),
    (r"^id_dsa$",                            "SSH DSA 私钥（已废弃但仍需保护）"),
    # R2：SSH 公钥（可推断账号身份，文档承诺覆盖）
    (r"^id_.*\.pub$",                        "SSH 公钥文件（*.pub）"),
    # 凭据 / 秘密文件名模式
    (r"^credentials",                        "凭据文件（credentials*）"),
    # R3：使用字母负向后瞻/前瞻替代 \b（\b 将 _ 视为词字符，导致 _secrets 边界失效）
    # (?<![a-z]) 防止 secretariat（前无字母的"secret"误报）
    # (?![a-z])  防止 tokenize / secretariat（后接字母的误报）
    # s? 兼容复数：secrets / tokens
    (r"(?<![a-z])secrets?(?![a-z])",         "含 'secret(s)' 的文件名（如 secret.json、app_secrets.yml）"),
    (r"(?<![a-z])tokens?(?![a-z])",          "含 'token(s)' 的文件名（如 access_token.txt）"),
    (r"^\.htpasswd$",                        "HTTP Basic Auth 密码文件"),
    (r"^\.pgpass$",                          "PostgreSQL 密码文件（.pgpass）"),   # R9
    (r"^\.netrc$",                           "FTP/HTTP 认证凭据文件（.netrc）"),  # R9
    (r"^\.npmrc$",                           "npm registry Token 文件（.npmrc）"), # R9
    # Kubernetes 配置（含集群凭据）
    (r"^\.kubeconfig$",                      "Kubernetes 配置文件（.kubeconfig）"),
    (r"^kubeconfig$",                        "Kubernetes 配置文件（kubeconfig）"),
    # R5：改为匹配 GCP 实际凭据 JSON 文件，而非目录名 .aws / 二进制 gcloud
    # R10：service.?account → service[_\-]?account，消除任意字符匹配歧义
    (r"service[_\-]?account.*\.json$",       "GCP 服务账号密钥文件"),
    (r"application[_\-]?default[_\-]?credentials.*\.json$",
                                             "GCP 应用默认凭据文件"),
    # Terraform 变量文件（常含 API Key）
    (r"\.tfvars$",                           "Terraform 变量文件（*.tfvars）"),   # R9
    # N4：Docker Compose 本地覆盖配置（通常含数据库密码等敏感配置）
    (r"^docker-compose\.override\.(yml|yaml)$",
                                             "Docker Compose 本地覆盖配置（docker-compose.override.yml）"),
]

# 预编译，统一使用 IGNORECASE
_compiled_patterns: list[tuple[re.Pattern[str], str]] = [
    (re.compile(pat, re.IGNORECASE), desc)
    for pat, desc in _SENSITIVE_PATTERNS
]

# 写操作工具名集合（大写，用于 O(1) 查找）
_WRITE_TOOLS: frozenset[str] = frozenset({
    "WRITE",
    "STRREPLACE",
    "EDITNOTEBOOK",
    "DELETE",  # R4：删除敏感文件同样视为写操作，直接 deny
})

def _extract_path_from_raw(raw_bytes: bytes) -> str:
    """
    从原始字节中提取 file_path，绕过编码问题。
    file_path 始终出现在 contents 之前，取前 512 字节即可覆盖。
    """
    head = raw_bytes[:512]
    for encoding in ("utf-8-sig", "utf-8", "gbk", "latin-1"):
        try:
            head_str = head.decode(encoding, errors="replace")
            for field in ("file_path", "path"):
                m = re.search(r'"' + field + r'"\s*:\s*"((?:[^"\\]|\\.)*)"', head_str)
                if m:
                    try:
                        return json.loads('"' + m.group(1) + '"')
                    except Exception:
                        # 尝试直接返回原始匹配（可能含转义符）
                        return m.group(1).replace('\\"', '"').replace('\\\\', '\\')
            break
        except Exception:
            continue
    return ""


def _is_sensitive(path_str: str) -> tuple[bool, str]:
    """
    判断给定路径的文件名是否为敏感文件。

    仅对 basename 做模式匹配，避免路径前缀干扰
    （如 /usr/local/bin/key-tool 不会误报）。
    返回 (is_sensitive, matched_description)。
    """
    if not path_str:
        return False, ""
    basename = Path(path_str).name
    for pattern, desc in _compiled_patterns:
        if pattern.search(basename):
            return True, desc
    return False, ""


def _rotate_log_if_needed() -> None:
    """R6/N2：日志文件超过 _MAX_LOG_SIZE 时轮转。

    N2 修复：备份文件名加入 UTC 时间戳（去除冒号以兼容 Windows 文件名规则），
    避免多次轮转时 .log.bak 被静默覆盖导致历史日志丢失。
    竞态条件（多进程并发轮转）由 OSError 静默捕获兜底，不阻断后续审计写入。
    """
    try:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > _MAX_LOG_SIZE:
            # N2：时间戳格式 20260630T120000Z，冒号替换为空以兼容 Windows 路径
            stamp = ts_utc().replace(":", "").replace("-", "")
            bak = LOG_FILE.with_name(f"{LOG_FILE.stem}.{stamp}.log.bak")
            LOG_FILE.rename(bak)
    except OSError as exc:
        sys.stderr.write(f"[sensitive_file_guard] 日志轮转失败: {exc}\n")
        sys.stderr.flush()


def _log(tool: str, path: str, decision: str, reason: str = "") -> None:
    """写入审计日志（JSONL 格式）。"""
    entry = {
        "time": ts_utc(),
        "tool": tool,
        "path": path[:_PATH_LOG_LIMIT],  # R7：使用具名常量
        "decision": decision,
        "reason": reason,
    }
    try:
        _rotate_log_if_needed()  # R6：写前检查轮转
        append_jsonl(LOG_FILE, entry)
    except Exception as exc:
        sys.stderr.write(f"[sensitive_file_guard] 日志写入失败: {exc}\n")
        sys.stderr.flush()


def main(raw: str) -> None:
    if not raw.strip():
        stdout_allow()
        return

    try:
        data = json.loads(raw)
    except Exception:
        # N1：JSON 整体解析失败（常见原因：大型文件 payload 超出管道缓冲、含特殊 Unicode 字符）
        # 回退策略：用正则提取 file_path，仅对文件名做敏感性判断
        # 只有真正无法获取路径，或路径命中敏感规则时才 deny
        fallback_path = _extract_path_from_raw(raw.encode("utf-8", errors="replace"))
        if fallback_path:
            sensitive, matched_desc = _is_sensitive(fallback_path)
            if not sensitive:
                _log("(fallback)", fallback_path, "allow",
                     "JSON 解析失败，正则提取路径非敏感，放行")
                stdout_allow()
                return
            # 路径命中敏感规则，仍然拒绝
            _log("(fallback)", fallback_path, "deny",
                 f"JSON 解析失败，正则提取路径命中敏感规则 - {matched_desc}")
            stdout_deny(
                f"[敏感文件防护] 操作已被拦截（JSON 解析回退模式）\n\n"
                f"文件路径：{fallback_path}\n"
                f"匹配规则：{matched_desc}",
                f"[sensitive_file_guard] 正则回退拒绝。路径: {repr(fallback_path[:_PATH_MSG_LIMIT])}",
            )
            return
        # 无法提取路径，Fail-Safe 拒绝
        try:
            _log("(error)", "(unparsed)", "deny",
                 f"JSON 解析失败且路径提取失败，安全拒绝 | raw: {raw[:200]}")
        except Exception:
            pass
        stdout_deny(
            "[敏感文件防护] 输入解析失败，操作已被安全拒绝。",
            "[sensitive_file_guard] JSON 解析失败，Fail-Safe 拒绝。",
        )
        return

    # Cursor preToolUse 实际发送 tool_name / tool_input，兼容旧字段 tool / input
    tool: str = (data.get("tool_name") or data.get("tool") or "").strip()
    # T2: isinstance(dict) explicit check; non-empty list bypasses `or {}` (truthy)
    # and causes AttributeError on .get() -- prefer explicit allow over implicit fallback
    _ti = data.get("tool_input")
    tool_input_raw = _ti if isinstance(_ti, dict) else data.get("input")
    if not isinstance(tool_input_raw, dict):
        stdout_allow()
        return
    tool_input: dict[str, object] = tool_input_raw

    # N3：用 isinstance 类型检查替代 str() 强转
    # Cursor 实际使用 file_path 字段，兼容旧字段 path；非字符串类型直接放行
    _fp = tool_input.get("file_path")
    raw_path = _fp if isinstance(_fp, str) else tool_input.get("path")
    if not isinstance(raw_path, str):
        stdout_allow()
        return
    path_str: str = raw_path.strip()

    if not path_str:
        stdout_allow()
        return

    sensitive, matched_desc = _is_sensitive(path_str)
    if not sensitive:
        stdout_allow()
        return

    tool_upper = tool.upper()
    is_write = tool_upper in _WRITE_TOOLS  # R4：包含 DELETE

    if is_write:
        # 写入/删除操作 → deny（绝对拒绝，防止覆盖/污染/删除敏感配置）
        _log(tool, path_str, "deny", f"写入/删除敏感文件 - {matched_desc}")
        stdout_deny(
            f"[敏感文件防护] 操作已被拦截\n\n"
            f"文件路径：{path_str}\n"
            f"匹配规则：{matched_desc}\n\n"
            f"写入或删除敏感文件可能覆盖、污染或永久丢失密钥、证书、凭据等机密配置。\n"
            f"如确有必要，请在终端手动操作，并确保文件已加入 .gitignore。",
            f"[sensitive_file_guard] 写入/删除敏感文件已拒绝。"
            f"路径: {repr(path_str[:_PATH_MSG_LIMIT])}，规则: {matched_desc}",  # R7
        )
    else:
        # 读取操作 → ask（提醒用户确认，防止意外泄露到对话上下文）
        _log(tool, path_str, "ask", f"读取敏感文件 - {matched_desc}")
        stdout_ask(
            f"[敏感文件防护] 检测到读取敏感文件，请确认\n\n"
            f"文件路径：{path_str}\n"
            f"匹配规则：{matched_desc}\n\n"
            f"读取敏感文件可能将密钥、Token、证书等机密信息暴露在对话上下文中。\n"
            f"请确认 Agent 确实需要读取该文件，并注意不要将内容复制到公开场合。\n\n"
            f"是否允许继续读取？",
            f"[sensitive_file_guard] 读取敏感文件已暂停，等待用户确认。"
            f"路径: {repr(path_str[:_PATH_MSG_LIMIT])}，规则: {matched_desc}",  # R7
        )


if __name__ == "__main__":
    configure_utf8_streams()

    _raw_bytes = sys.stdin.buffer.read()  # U1: read raw bytes, bypass text layer
    #  U1: try UTF-8-sig first (strips BOM); fall back to GBK (Windows CP936)
    try:
        _raw = _raw_bytes.decode("utf-8-sig")  # utf-8-sig 自动剥离 BOM（\xef\xbb\xbf）
    except UnicodeDecodeError:
        try:
            _raw = _raw_bytes.decode("gbk")   # Windows CP936 fallback
        except UnicodeDecodeError:
            _raw = _raw_bytes.decode("utf-8", errors="replace")  # last resort
    try:
        main(_raw)
    except Exception:
        tb = traceback.format_exc()
        sys.stderr.write(tb)
        sys.stderr.flush()
        # R1：Fail-Safe — 异常时拒绝而非放行，防止构造异常输入绕过防护
        try:
            _log("(error)", "(unparsed)", "deny",
                 f"未处理异常，安全拒绝: {tb[:300]} | raw: {_raw[:200]}")
        except Exception:
            pass
        stdout_deny(
            "[敏感文件防护] 内部异常，操作已被安全拒绝，请检查 Hook 日志。",
            "[sensitive_file_guard] 内部异常，Fail-Safe 拒绝。",
        )

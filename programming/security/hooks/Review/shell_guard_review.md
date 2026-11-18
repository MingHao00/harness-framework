# Code Review：`shell_guard.py`

**初审日期**：2026-06-29（第一轮）  
**复审日期**：2026-06-29（第二轮，基于修复后版本）  
**三审日期**：2026-06-29（第三轮，基于修复后版本）  
**四审日期**：2026-06-30（第四轮，基于修复后版本）  
**审阅对象**：`<WORKSPACE>/Hook/shell_guard.py`  
**关联文件**：`<WORKSPACE>/Hook/hook_utils.py`  
**审阅人**：AI Code Reviewer  

---

## 总体评价

### 第四轮评价

T1–T4 全部修复正确。`hook_utils.py` 的 `configure_utf8_streams()` 重构干净，模块级副作用彻底消除。四轮累计 18 项问题均已解决。

本轮新发现 **5 项问题**（U1–U5）：其中 U1 属低危（dd 规则存在磁盘分区漏报），U2–U5 属建议级。代码整体已接近生产级别。

---

### 第三轮评价（存档）

N1–N3 全部修复正确。代码整体已进入高质量状态，三轮累计 14 项问题均已解决。

本轮新发现 **4 项问题**（T1–T4）：T1 属低危，T2–T4 属建议级。其中 T1 涉及 `hook_utils.py` 与 `shell_guard.py` 的协同问题，**N3 的修复在 `hook_utils.py` 存在同类代码的情况下实际上是不完整的**，需关注。

---

## 第三轮修复验证

| 原编号 | 问题标题 | 修复状态 | 验证说明 |
|--------|----------|----------|----------|
| T1 | `hook_utils.py` 模块级 `reconfigure()` | ✅ 已修复 | 提取为 `configure_utf8_streams()` 函数，不在 import 时执行 |
| T2 | `except (AttributeError, Exception)` 冗余 | ✅ 已修复 | 改为 `except (AttributeError, OSError)`，精准覆盖 `io.UnsupportedOperation` |
| T3 | 异常日志 `command` 字段语义歧义 | ✅ 已修复 | 改为 `"(unparsed)"`，原始 JSON 嵌入 `reason` 字段 |
| T4 | Python 版本未声明 | ✅ 已修复 | 添加 `from __future__ import annotations`，docstring 说明最低版本 |

---

## 第二轮修复验证

| 原编号 | 问题标题 | 修复状态 | 验证说明 |
|--------|----------|----------|----------|
| N1 | `git push --force` 60字符限制 | ✅ 已修复 | L142 扩展至 `[^;\|&\n]{0,120}` |
| N2 | `git reset --hard` 40字符限制 | ✅ 已修复 | L147 扩展至 `[^;\|&\n]{0,120}` |
| N3 | `reconfigure()` 模块级执行 | ✅ 已修复（经 T1 彻底修复）| `shell_guard.py` 改为调用 `configure_utf8_streams()` |

---

## 第一轮修复验证

| 原编号 | 问题标题 | 修复状态 | 验证说明 |
|--------|----------|----------|----------|
| F1 | `rm -r -f` 分离参数绕过 | ✅ 已修复 | L56–57 双前瞻断言分别检测 `-r`/`--recursive` 和 `-f`/`--force` |
| F2 | 命令链 DENY 降级 | ✅ 已修复 | L59–60 路径锚点改为 `(?:$\|[;\|&\n])` |
| F3 | `Remove-Item` 规则冗余/漏别名 | ✅ 已修复 | L112–114 合并 `Remove-Item\|ri`，保留 `-Recurse\|-r` |
| F4 | `pip uninstall` 40字符限制 | ✅ 已修复 | L163 扩展至 `[^;\|&\n]{0,120}` |
| F5 | `git commit` 60字符限制 | ✅ 已修复 | L184 扩展至 `[^;\|&\n]{0,120}` |
| F6 | 多 commit 只校验第一条 | ✅ 已修复 | L221 改为 `_GIT_COMMIT_RE.finditer()` |
| F7 | Fail-open 异常不写日志 | ✅ 已修复 | L305–308 异常路径写入 `_log("ERROR", ...)` |
| F8 | 提示消息缺失 `wip` 类型 | ✅ 已修复 | L45 `_CC_TYPES_DISPLAY` 从 `_CC_TYPES` 统一生成 |
| F9 | `re.DOTALL` 冗余 | ✅ 已修复 | L192–193 及 L186 均已移除 |
| F10 | `stdout_ask` 未纳入工具库 | ✅ 已修复 | L39 从 `hook_utils` 导入；`hook_utils.py` 中已添加 |
| F11 | 日志截断 400 字符 | ✅ 已修复 | L203 扩展至 1000，L204–206 新增 `command_sha256` |

---

## 第四轮新发现汇总

| 编号 | 严重程度 | 位置 | 标题 |
|------|----------|------|------|
| U1 | 🟡 低危 | `DENY_RULES` L87 | `dd` 规则使用 `\b` 词边界，磁盘分区设备（`/dev/sda1`）完全漏过 |
| U2 | 🔵 建议 | `main()` L266–268 | JSON 解析失败静默放行，无审计日志条目 |
| U3 | 🔵 建议 | `_check_git_commit_msg` L240 | 多行 commit 消息（首行合规）触发误报 CC 格式警告 |
| U4 | 🔵 建议 | `hook_utils.py` L61 | `stdout_allow()` 缺少 `-> None` 返回类型注解，与其他函数不一致 |
| U5 | 🔵 建议 | `shell_guard.py` L40 | `from __future__ import annotations` 注释说"最低版本 3.10"，实际 3.7+ 即可运行 |

---

## 第四轮新发现详情

---

### U1 🟡 低危 — `dd` DENY 规则使用词边界，磁盘分区设备漏报

**位置**：`DENY_RULES` L87

**问题描述**：

```python
r"\bdd\b.*\bof\s*=\s*\/dev\/(sd[a-z]|hd[a-z]|nvme\d+n\d+)\b"
```

规则末尾的 `\b` 词边界要求设备名后跟非单词字符（空白/行尾）。对于分区设备（字母后紧跟数字），`\b` 不匹配：

```bash
dd if=/dev/zero of=/dev/sda    # sda 后跟空格 → \b 匹配 → DENY ✓
dd if=/dev/zero of=/dev/sda1   # sda1 后跟空格 → sda\b 中 'a' 后跟 '1' (均为 \w) → 不匹配！
dd if=/dev/zero of=/dev/sdb2   # 同上 → 漏过！
dd if=/dev/zero of=/dev/nvme0n1p1  # 同上 → 漏过！
```

**结果**：对磁盘分区的 `dd` 覆写完全不受任何规则（DENY 或 ASK）拦截，直接放行。虽然分区覆写破坏性低于整盘覆写，但仍可导致文件系统损坏、数据永久丢失。

**修复建议**：

方案一：去掉末尾 `\b`，改用空白/行尾锚点：

```python
r"\bdd\b.*\bof\s*=\s*\/dev\/(sd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)(?:\s|$)"
```

方案二（推荐）：将磁盘设备（DENY）和分区设备（ASK）分为两条规则：

```python
# DENY：整盘覆写
(
    r"\bdd\b.*\bof\s*=\s*\/dev\/(sd[a-z]|hd[a-z]|nvme\d+n\d+)(?:\s|$|[|;&])",
    "覆写磁盘块设备（整盘）",
),
# ASK：分区覆写（降级到 ask）
(
    r"\bdd\b.*\bof\s*=\s*\/dev\/(sd[a-z]\d+|hd[a-z]\d+|nvme\d+n\d+p\d+)(?:\s|$|[|;&])",
    "覆写磁盘分区（dd of=/dev/...）",
),
```

---

### U2 🔵 建议 — JSON 解析失败静默放行，无审计日志

**位置**：`main()` L264–268

**问题描述**：

```python
try:
    data = json.loads(raw)
except Exception:
    stdout_allow()   # ← 无日志！
    return
```

当 JSON 解析失败时，命令被静默放行，`shell_guard.log` 中没有任何记录。与 F7 修复的一致性相比，此路径存在审计盲区。虽然 Cursor 传入畸形 JSON 的可能性极低，但若发生，维护者无法从日志中发现和诊断问题。

注：同样情况也适用于 `command` 字段为空时的路径（L271–273），尽管这种情况更正常。

**修复建议**：

```python
try:
    data = json.loads(raw)
except Exception as exc:
    _log("WARN", "(invalid-json)", "allow", f"JSON 解析失败: {exc} | raw: {raw[:200]}")
    stdout_allow()
    return
```

---

### U3 🔵 建议 — 多行 commit 消息首行合规但触发误报

**位置**：`_check_git_commit_msg` L240，`_CC_PATTERN` L193–196

**问题描述**：

`_GIT_COMMIT_RE` 捕获的消息内容使用 `[^"]+`，该字符类匹配换行符（`\n`）。因此多行 commit 消息会被完整捕获：

```bash
git commit -m "feat(api): 添加用户注册接口

详细实现了 POST /register 接口，包含：
- 参数校验
- 密码哈希"
```

捕获的 `msg` = `"feat(api): 添加用户注册接口\n\n详细实现..."`

`_CC_PATTERN` 使用 `\S.{0,200}$` 匹配描述部分，但 `.` 不匹配 `\n`（无 `re.DOTALL`），`$` 在无 `re.MULTILINE` 时只匹配字符串末尾。因此 `_CC_PATTERN.match(msg)` 对多行消息**返回 `None`（不匹配）**，触发格式警告——即使首行完全符合 CC 规范。

**影响**：使用多行 commit 消息的用户（这是 git 推荐的良好实践）会频繁收到误报警告，降低 Hook 的可用性和可信度。

**修复建议**：

仅对 commit 消息的第一行（主题行）做格式校验，截取第一个 `\n` 之前的内容：

```python
def _check_git_commit_msg(command: str) -> tuple[str, str] | None:
    for m in _GIT_COMMIT_RE.finditer(command):
        msg = next((g for g in m.groups() if g is not None), "").strip()
        if not msg:
            continue
        # 仅校验主题行（第一行），忽略正文和脚注
        subject = msg.split("\n")[0].strip()
        if not subject or _CC_PATTERN.match(subject):
            continue
        user_msg = (
            f"[Shell Guard] git commit 消息不符合约定式提交（Conventional Commits）规范。\n\n"
            f"主题行：\"{subject}\"\n\n"
            ...
        )
        return user_msg, agent_msg
    return None
```

---

### U4 🔵 建议 — `stdout_allow()` 缺少返回类型注解

**位置**：`hook_utils.py` L61

**问题描述**：

```python
def stdout_allow():              # ← 无类型注解
def stdout_ask(...) -> None:     # 有注解 ✓
def stdout_deny(...) -> None:    # 有注解 ✓
def configure_utf8_streams() -> None:  # 有注解 ✓
```

`stdout_allow()` 是三个输出函数中唯一缺少参数和返回类型注解的，与整个文件的风格不一致。

**修复建议**：

```python
def stdout_allow() -> None:
    sys.stdout.write('{"permission":"allow"}\n')
    sys.stdout.flush()
```

---

### U5 🔵 建议 — `from __future__ import annotations` 注释版本说明偏差

**位置**：`shell_guard.py` L40

**问题描述**：

```python
from __future__ import annotations  # T4：延迟注解求值，最低版本 Python 3.10（X|Y 联合类型）
```

注释说"最低版本 Python 3.10"，但 `from __future__ import annotations`（PEP 563）在 Python 3.7 即可用。启用后，所有注解变为字符串字面量，不在运行时求值，因此 `tuple[str, str] | None` 语法在 Python 3.7+ 均可使用。

注释中 3.10 的说法可能误导维护者认为代码需要 Python 3.10+ 才能运行。

**修复建议**：

更新注释，准确说明运行时版本要求：

```python
from __future__ import annotations  # PEP 563：延迟注解求值。
                                     # 使 X|Y 联合类型语法在 Python 3.7+ 运行时可用。
                                     # 若移除此行，需升级至 Python 3.10+。
```

---

## 第三轮新发现汇总

| 编号 | 严重程度 | 位置 | 标题 |
|------|----------|------|------|
| T1 | 🟡 低危 | `hook_utils.py` L13–18 | N3 修复不完整：`hook_utils.py` 仍在模块级执行 `reconfigure()` |
| T2 | 🔵 建议 | `shell_guard.py` L302 | `except (AttributeError, Exception)` 冗余，`AttributeError` 是 `Exception` 子类 |
| T3 | 🔵 建议 | `shell_guard.py` L314 | 异常日志 `command` 字段含原始 JSON，`command_sha256` 指向输入而非命令 |
| T4 | 🔵 建议 | 全局 | Python 最低版本未声明，`tuple[str, str] \| None` 语法需 Python 3.10+ |

---

## 第三轮新发现详情

---

### T1 🟡 低危 — N3 修复不完整：`hook_utils.py` 仍在模块级执行 `reconfigure()`

**位置**：`hook_utils.py` L13–18，`shell_guard.py` L38（`import hook_utils`）

**问题描述**：

`shell_guard.py` 的 N3 修复将 `reconfigure()` 从模块级移入 `__main__` 块：

```python
# shell_guard.py L299–303（N3 修复后）
if __name__ == "__main__":
    for _stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, Exception):
            pass
```

然而，`shell_guard.py` 第 38 行会 import `hook_utils`：

```python
from hook_utils import append_jsonl, stdout_allow, stdout_ask, stdout_deny, ts_utc
```

`hook_utils.py` 模块级代码会**在 import 时立即执行**（L13–18）：

```python
# hook_utils.py L13–18（仍在模块级）
try:
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass  # Python < 3.7 无 reconfigure，忽略
```

因此：

1. **测试环境中 `import hook_utils` 依然触发 `reconfigure()`**，N3 的测试兼容性目标没有完全实现。
2. **`hook_utils.py` 只捕获 `AttributeError`**，但 pytest 等框架替换 `sys.stdout` 时可能抛出 `io.UnsupportedOperation`（当对象有 `reconfigure` 方法但不支持该操作时），该异常**不会被捕获**，导致 import 失败。
3. **生产环境出现双重 reconfigure**：`hook_utils.py` 在 import 时执行一次，`__main__` 再执行一次，属于冗余调用（功能上无害，但代码意图混乱）。

**影响**：在测试框架中 mock 了 `sys.stdout` 为不完全兼容的对象时，`import hook_utils` 本身可能失败，导致所有测试崩溃。

**修复建议**：

将 `hook_utils.py` 中的 `reconfigure()` 提取为工具函数，供各调用方按需执行，不在模块加载时自动运行：

```python
# hook_utils.py：改为函数，不在模块级执行
def configure_utf8_streams() -> None:
    """强制 stdin/stdout/stderr 使用 UTF-8（Windows GBK 环境修正）。"""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass
```

```python
# shell_guard.py __main__ 中显式调用
if __name__ == "__main__":
    from hook_utils import configure_utf8_streams
    configure_utf8_streams()
    _raw = sys.stdin.read()
    ...
```

此方案同时修复了 `hook_utils.py` 中只捕获 `AttributeError`（应捕获 `OSError`，其父类覆盖 `io.UnsupportedOperation`）的问题。

---

### T2 🔵 建议 — `except (AttributeError, Exception)` 冗余

**位置**：`shell_guard.py` L302

**问题描述**：

```python
# L299–303
for _stream in (sys.stdin, sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, Exception):   # ← AttributeError 是 Exception 子类，冗余！
        pass
```

`AttributeError` 是 `Exception` 的子类。在同一个 `except` 元组中同时列出父类和子类，子类永远不会单独触发，是一个无意义的冗余写法。

原始建议（第二轮报告）是 `except (AttributeError, io.UnsupportedOperation)`，当前实现将其简化为 `except (AttributeError, Exception)`，反而变得过于宽泛（会吞掉所有非 `BaseException` 的异常，包括潜在的有用错误信息）。

**对比**：

| 方案 | 描述 |
|------|------|
| `except (AttributeError, Exception)` | 冗余且过于宽泛（当前代码）|
| `except Exception` | 宽泛，等价于当前代码，但更简洁 |
| `except (AttributeError, OSError)` | 精准：`OSError` 覆盖 `io.UnsupportedOperation` ✅ 推荐 |

**修复建议**：

```python
except (AttributeError, OSError):
    pass
```

`io.UnsupportedOperation` 是 `OSError` 和 `ValueError` 的子类，`except OSError` 即可覆盖。

---

### T3 🔵 建议 — 异常日志 `command` 字段含原始 JSON

**位置**：`shell_guard.py` L314

**问题描述**：

```python
# L314
_log("ERROR", _raw[:200], "allow", f"未处理异常: {tb[:300]}")
```

`_raw` 是来自 stdin 的原始 JSON 字符串（如 `{"command": "some cmd"}`）。当异常在 `main()` 内部（命令已解析后）抛出时，`_raw[:200]` 包含完整 JSON；当异常在解析前抛出时，`command` 字段就是 JSON 文本。

两个问题：

1. **审计字段语义不一致**：`command` 字段有时是实际命令，有时是原始 JSON，阅读日志时容易混淆。
2. **`command_sha256` 指向原始输入**：`_log` 内部对传入的 `command` 参数计算哈希，此时哈希是 `_raw[:200]` 的哈希，而非实际 shell 命令的哈希，与其他正常日志条目的哈希语义不同。

**修复建议**：

在错误日志中明确标识字段含义，使用不同的 key 名：

```python
# 方案：在 reason 中嵌入原始输入，command 字段留空或使用占位符
_log("ERROR", "(unparsed)", "allow", f"未处理异常: {tb[:300]} | raw_input: {_raw[:200]}")
```

或在 `_log` 函数中增加可选的 `raw_input` 字段以区分两种情况。

---

### T4 🔵 建议 — Python 最低版本未声明

**位置**：`shell_guard.py` 全局

**问题描述**：

代码使用了以下版本特定语法：

| 语法 | 最低版本 |
|------|----------|
| `list[tuple[str, str]]`（内建泛型，非 `typing`） | Python 3.9+ |
| `tuple[str, str] \| None`（`X \| Y` 联合类型注解） | Python 3.10+ |
| `sys.stdin.reconfigure()` | Python 3.7+ |

实际最低要求是 **Python 3.10**，但模块 docstring 和 `hook_utils.py` 中的注释 `# Python < 3.7 无 reconfigure，忽略` 反映的是 3.7 的下限，导致版本边界信息不一致。

**修复建议**：

在模块 docstring 中明确声明最低版本，或使用 `from __future__ import annotations` 将注解延迟求值以兼容 Python 3.7+：

```python
# 方案一（推荐）：在 docstring 中声明
"""
shell_guard.py — beforeShellExecution Hook
最低 Python 版本：3.10（使用了 X | Y 联合类型语法）
"""

# 方案二：延迟注解求值（兼容 Python 3.7+）
from __future__ import annotations
```

---

## 第二轮新发现汇总

| 编号 | 严重程度 | 位置 | 标题 |
|------|----------|------|------|
| N1 | 🟠 中危 | `ASK_RULES` L143 | `git push --force` 60字符限制未同步修复，长分支名可绕过 |
| N2 | 🟡 低危 | `ASK_RULES` L148 | `git reset --hard` 40字符限制未同步扩展 |
| N3 | 🟡 低危 | `main()` L35–37 | `sys.stdin.reconfigure()` 在非标准环境可能抛出异常 |

---

## 第二轮新发现详情

---

### N1 🟠 中危 — `git push --force` 60字符限制未同步修复

**位置**：`ASK_RULES` L143

**问题描述**：

第一轮审阅的 F5 只修复了 `_GIT_COMMIT_RE`（120字符），但相同问题同样存在于 `git push --force` 规则：

```python
# ASK_RULES L143（未修复）
r"\bgit\s+push\b[^|;&\n]{0,60}(--force\b|-f\b)"
```

当推送目标为长分支名时，`--force` 标志可能超出 60 字符范围：

```bash
# git push 后到 --force 的距离：
# " origin feature/some-ticket-12345-very-long-feature-branch-name " = 65 chars → 漏过！
git push origin feature/some-ticket-12345-very-long-feature-branch-name --force
git push --set-upstream origin feature/long-branch-name-over-60chars --force
```

字符计数验证：

```
git push[消费] origin feature/some-ticket-12345-very-long-feature-branch-name --force
         ↑ [^|;&\n]{0,60} 最多匹配60字符 ↑                             ↑ --force 在第65位，超出范围！
```

**影响**：`git push --force` 对长分支名的强制推送保护失效，不会触发用户确认。

**修复建议**：

与 F5 保持一致，将限制从 60 扩展至 120：

```python
(
    r"\bgit\s+push\b[^|;&\n]{0,120}(--force\b|-f\b)",
    "Git 强制推送（git push --force）",
),
```

---

### N2 🟡 低危 — `git reset --hard` 40字符限制未同步扩展

**位置**：`ASK_RULES` L148

**问题描述**：

```python
# ASK_RULES L148（仍为 40 字符）
r"\bgit\s+reset\b[^|;&\n]{0,40}--hard\b"
```

`git reset` 的常见参数形式通常较短（如 `HEAD~1`、`FETCH_HEAD`），40 字符限制在多数场景足够，但以下用法可触发漏报：

```bash
git reset origin/some-feature-branch-name --hard   # 约 38 chars → 临界
git reset refs/remotes/origin/very-long-branch-name --hard   # 超出 → 漏过！
```

**影响**：使用完整 refs 路径时，`--hard` 可能超出 40 字符范围，导致规则漏判。

**修复建议**：

与 `git push` 规则保持一致，统一扩展至 120：

```python
(
    r"\bgit\s+reset\b[^|;&\n]{0,120}--hard\b",
    "Git 硬重置，丢弃未提交更改（git reset --hard）",
),
```

---

### N3 🟡 低危 — `sys.stdin.reconfigure()` 在非标准环境可能抛出异常

**位置**：L35–37（在 `if __name__ == "__main__"` 块外部，模块级执行）

**问题描述**：

```python
# L35-37：模块顶层执行，无任何异常保护
sys.stdin.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
```

`reconfigure()` 是 `TextIOWrapper` 的方法，在以下场景可能失败：

1. **流已被替换**：测试框架（pytest、unittest）或 IDE 调试器可能将 `sys.stdin/stdout` 替换为非 `TextIOWrapper` 的对象（如 `io.BytesIO`、StringIO 等），`reconfigure()` 调用会抛出 `AttributeError` 或 `io.UnsupportedOperation`。

2. **写入已被刷新的流**：若父进程以二进制模式打开管道，`reconfigure()` 可能失败。

**当前影响**：代码在生产中（Cursor Hook 触发）功能正常，但在**单元测试环境**下可能因流被替换而导致测试无法启动，需要额外的 mock 设置。这会增加测试编写的复杂度。

**修复建议**：

将 `reconfigure()` 调用包裹在 `try/except` 中，并移入 `if __name__ == "__main__"` 块或使用 `hasattr` 检测：

```python
# 方案一：防御性调用，仅在支持时执行
for stream, name in [(sys.stdin, "stdin"), (sys.stdout, "stdout"), (sys.stderr, "stderr")]:
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, io.UnsupportedOperation):
        pass

# 方案二：仅在 __main__ 入口处执行（不影响 import 时的测试）
if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    _raw = sys.stdin.read()
    ...
```

---

## 新增推荐测试用例（第四轮）

| 测试场景 | 期望结果 | 覆盖问题 |
|----------|----------|----------|
| `dd if=/dev/zero of=/dev/sda1` | ask 或 deny（当前：allow，漏报）| U1 |
| `dd if=/dev/zero of=/dev/nvme0n1p1` | ask 或 deny（当前：allow，漏报）| U1 |
| 输入畸形 JSON `{"command": bad}` | allow + 日志写入（当前：allow 无日志）| U2 |
| `git commit -m "feat: ok\n\n详细说明..."` | allow（当前：误报 CC 警告）| U3 |
| `git commit -m "feat(scope): 标题\n\n正文"` | allow（当前：误报 CC 警告）| U3 |

---

## 新增推荐测试用例（第三轮）

以下测试场景覆盖第三轮新发现问题及修复验证：

| 测试场景 | 期望结果 | 覆盖问题 |
|----------|----------|----------|
| 在 pytest 中 `import hook_utils`（不 mock stdout） | 成功导入 | T1 |
| 在 pytest 中 `import hook_utils`（pytest 已替换 sys.stdout） | 成功导入，不抛出 UnsupportedOperation | T1 |
| 构造触发 `main()` 内部异常的畸形 JSON | 日志 `command` 字段含有意义的标识（非原始 JSON） | T3 |

---

## 新增推荐测试用例（第二轮）

以下测试场景覆盖新发现的问题及修复后的规则边界验证：

| 测试场景 | 期望结果 | 覆盖问题 |
|----------|----------|----------|
| `git push origin feature/some-ticket-12345-very-long-feature-branch-name --force` | ask | N1（当前漏过）|
| `git push --set-upstream origin feature/long-branch-name-over-60chars -f` | ask | N1（当前漏过）|
| `git reset refs/remotes/origin/very-long-branch --hard` | ask | N2（当前漏过）|
| `rm -r -f /` | deny | F1 修复验证 |
| `rm --recursive --force /` | deny | F1 修复验证 |
| `rm -rf / && echo done` | deny | F2 修复验证 |
| `git commit --no-verify --gpg-sign=ABCDEFGH01234 -m "bad message"` | ask | F5 修复验证 |
| `git commit -m "feat: ok" && git commit -m "bad"` | ask | F6 修复验证 |
| `pip uninstall some-very-long-package-name-that-exceeds-40-chars -y` | ask | F4 修复验证 |
| `git commit -m "wip: 临时保存"` | allow | F8 修复验证 |
| `Remove-Item -Recurse .\folder` | ask | F3 修复验证 |
| `ri -r .\important` | ask | F3 修复验证 |

---

## 第一轮发现详情（已修复，存档参考）

<details>
<summary>点击展开第一轮发现详情（F1–F11，均已修复）</summary>

### F1 🔴 高危（已修复）— `rm -r -f` 分离参数绕过所有规则

**原始问题**：标志模式 `-[^\s]*r[^\s]*f[^\s]*` 要求 `r` 和 `f` 在同一词元，`rm -r -f /` 和 `rm --recursive --force /` 均漏过。

**修复方案**（L56–57）：

```python
r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*r[a-zA-Z]*\b|\s--recursive\b))"
r"(?=[^|;&\n]*(?:\s-[a-zA-Z]*f[a-zA-Z]*\b|\s--force\b))"
```

---

### F2 🔴 高危（已修复）— `rm -rf /` 命令链从 DENY 降级为 ASK

**原始问题**：路径锚点 `$` 仅匹配字符串末尾，命令链 `rm -rf / && echo done` 跳过 DENY。

**修复方案**（L59–60）：路径后允许 `(?:$|[|;&\n])` 命令分隔符。

---

### F3 🟠 中危（已修复）— `Remove-Item` 规则冗余/漏别名

**原始问题**：冗余的第二分支 + 未覆盖 `ri` 别名。

**修复方案**（L112–114）：`\b(Remove-Item|ri)\b[^|;&\n]{0,80}(?:-Recurse\b|-r\b)`

---

### F4 🟠 中危（已修复）— `pip uninstall` 包名过长绕过

**原始问题**：`.{0,40}` 限制使得长包名后的 `-y` 超出范围。

**修复方案**（L163）：改为 `[^|;&\n]{0,120}`。

---

### F5 🟠 中危（已修复）— `git commit` 标志段 60字符限制

**原始问题**：`_GIT_COMMIT_RE` 中 `[^|;&\n]{0,60}` 使多标志命令漏检。

**修复方案**（L184）：扩展至 `[^|;&\n]{0,120}`。

---

### F6 🟠 中危（已修复）— 多 `git commit` 命令链只校验第一条

**原始问题**：`re.search()` 仅匹配第一条 commit。

**修复方案**（L221）：改为 `_GIT_COMMIT_RE.finditer()`。

---

### F7 🟡 低危（已修复）— Fail-open 异常不写审计日志

**原始问题**：异常时只写 stderr，不写 `shell_guard.log`。

**修复方案**（L305–308）：异常路径增加 `_log("ERROR", ...)` 调用。

---

### F8 🟡 低危（已修复）— 用户提示消息 `wip` 类型缺失

**原始问题**：`_CC_TYPES` 含 `wip` 但用户消息硬编码遗漏。

**修复方案**（L45, L231）：引入 `_CC_TYPES_DISPLAY`，从 `_CC_TYPES` 统一生成。

---

### F9 🔵 建议（已修复）— `re.DOTALL` 旗标冗余

**原始问题**：所有模式使用字符类而非 `.`，`re.DOTALL` 无实际效果。

**修复方案**（L192–193, L186）：全部移除 `re.DOTALL`。

---

### F10 🔵 建议（已修复）— `stdout_ask` 未纳入 `hook_utils.py`

**原始问题**：`ask` 响应函数定义在主文件内，违反 DRY。

**修复方案**（L39）：迁移至 `hook_utils.py` 并通过 import 使用。

---

### F11 🔵 建议（已修复）— 日志截断 400 字符

**原始问题**：截断过短影响审计完整性。

**修复方案**（L203–206）：截断扩展至 1000，新增 `command_sha256` 字段。

</details>

---

## 正面亮点（第四轮更新）

- **三级拦截架构**保持清晰，DENY 先于 ASK 的优先级正确。
- **双前瞻断言**（L56–57, L96–98）是修复 F1 的最优方案，覆盖所有参数顺序和形式。
- **`finditer` 替换 `search`**（L221）正确处理命令链场景。
- **`_CC_TYPES_DISPLAY` 统一生成**（L45）消除了类型列表两处维护不同步的根本原因。
- **`command_sha256`**（L204–206）引入后，即使日志截断也可通过哈希比对原始命令，审计能力显著增强。
- **Windows UTF-8 编码修正**（L35–37）解决了中文命令在 GBK/CP936 环境下被错误解码的问题，是重要的可用性改进。
- **`main(raw)` 参数化**（L242）使 `_raw` 在异常处理块中可访问，设计更合理。

---

## 当前优先修复顺序

> F1–F11、N1–N3、T1–T4 共 18 项均已修复，以下为第四轮剩余问题。

1. **U1**（`dd` 规则分区漏报）— 低危，一次正则扩展即可修复，影响磁盘分区安全
2. **U3**（多行 commit 消息误报）— 建议级，但影响日常使用体验，优先修复
3. **U2**（JSON 解析失败无日志）— 建议级，三行代码修复
4. **U4**（`stdout_allow` 缺少类型注解）— 建议级，一行修改
5. **U5**（`__future__` 注释版本说明偏差）— 建议级，注释澄清即可

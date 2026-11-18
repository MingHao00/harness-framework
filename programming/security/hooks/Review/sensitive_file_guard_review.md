# 代码审阅报告：`sensitive_file_guard.py`

**审阅文件**：`D:/Python/Hook/sensitive_file_guard.py`  
**辅助文件**：`D:/Python/Hook/hook_utils.py`  
**首次审阅**：2026-06-30 10:59 (UTC+8)  
**本次更新**：2026-06-30 11:21 (UTC+8)  
**审阅者**：AI Code Reviewer  

---

## 总体评价

该脚本作为 Cursor preToolUse Hook 承担着防止 Agent 意外读写敏感文件的安全职责。本次复审基于上一轮报告提出的 10 项问题，确认开发者已全部修复（R1–R10），代码质量显著提升。

当前版本整体设计清晰、规则覆盖更全面，Fail-Safe 机制已生效。但在本次复审中发现 **4 项新问题**，其中 1 项属中危。

---

## 第一部分：上轮问题修复验证

| # | 原问题 | 修复状态 | 修复说明 |
|---|---|---|---|
| R1 | 异常路径 Fail-Open | ✅ 已修复 | 第 239–248 行改为 `stdout_deny()`，并写入 `deny` 审计日志 |
| R2 | `*.pub` 规则缺失 | ✅ 已修复 | 第 88 行添加 `^id_.*\.pub$` |
| R3 | `token`/`secret` 模式过宽 | ✅ 已修复 | 第 95–96 行改用字母负向后瞻/前瞻 + 兼容复数 `s?` |
| R4 | Delete 工具未覆盖 | ✅ 已修复 | 第 124 行 `_WRITE_TOOLS` 加入 `DELETE` |
| R5 | `.aws`/`gcloud` 规则偏差 | ✅ 已修复 | 移除两条无效规则，添加 GCP 应用默认凭据规则 |
| R6 | 日志无轮转 | ✅ 已修复 | 新增 `_rotate_log_if_needed()`，超 10 MB 轮转 |
| R7 | 截断长度不一致 | ✅ 已修复 | 第 56–57 行定义 `_PATH_LOG_LIMIT` / `_PATH_MSG_LIMIT` |
| R8 | 类型注解不完整 | ✅ 已修复 | 第 185 行改为 `dict[str, object]` |
| R9 | 缺失敏感文件模式 | ✅ 已修复 | 补充 `*.tfvars`、`*.asc`、`.pgpass`、`.netrc`、`.npmrc`、`*.p8` |
| R10 | `service.?account` 正则歧义 | ✅ 已修复 | 第 106 行改为 `service[_\-]?account` |

---

## 第二部分：本次新发现问题

---

### 🟠 中危（Medium）

#### N1. JSON 解析失败路径仍为 Fail-Open，与 R1 修复原则不一致

**位置**：第 179–182 行

```python
try:
    data = json.loads(raw)
except Exception:
    stdout_allow()   # ← 仍为 Fail-Open
    return
```

**问题**：R1 修复了顶层异常的 Fail-Safe，但 JSON 解析失败路径仍然使用 `stdout_allow()` 放行。畸形 JSON 可通过以下场景触发：

- **主动构造**：恶意输入 `{not valid json` 即可绕过所有防护规则。
- **编码问题**：在特殊编码环境下，合法请求因解码失败变为畸形 JSON，导致意外放行。

R1 的修复注释写道"Fail-Safe — 异常时拒绝而非放行，防止构造异常输入绕过防护"，但 JSON 解析层同样存在相同绕过路径，导致防护原则前后不一致。

**建议修复**：

```python
try:
    data = json.loads(raw)
except Exception:
    # Fail-Safe：无法解析输入时，无法判断操作安全性，选择拒绝
    try:
        _log("(error)", "(unparsed)", "deny",
             f"JSON 解析失败，安全拒绝 | raw: {raw[:200]}")
    except Exception:
        pass
    stdout_deny(
        "[敏感文件防护] 输入解析失败，操作已被安全拒绝。",
        "[sensitive_file_guard] JSON 解析失败，Fail-Safe 拒绝。",
    )
    return
```

> **权衡说明**：若担心 Cursor 自身 bug 导致合法请求被误拒，可改为 `stdout_ask()` 作为折中方案，要求用户手动确认。

---

### 🟡 低危 / 代码质量（Low / Informational）

#### N2. 日志轮转未持有文件锁，存在竞态条件

**位置**：第 145–153 行（`_rotate_log_if_needed`）

```python
def _rotate_log_if_needed() -> None:
    try:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > _MAX_LOG_SIZE:
            bak = LOG_FILE.with_suffix(".log.bak")
            LOG_FILE.rename(bak)   # ← 未持锁，有 TOCTOU 风险
    except OSError as exc:
        ...
```

`_rotate_log_if_needed()` 在 `_log()` 中被调用，但在 `append_jsonl()` 的文件锁（`FileLock`）之外执行。若多个 Hook 进程并发运行：

1. 进程 A 和进程 B 同时判断 `LOG_FILE.stat().st_size > _MAX_LOG_SIZE`，结果均为 `True`
2. 进程 A 先执行 `rename`，成功
3. 进程 B 再执行 `rename`，此时 `LOG_FILE` 已不存在，`OSError` 被静默捕获
4. 进程 B 的 `append_jsonl()` 会创建新的 `LOG_FILE`，正常写入
5. 但进程 A rename 的 `.log.bak` 会被进程 B 下次轮转时覆盖，历史日志丢失

此外，`rename(bak)` 会静默覆盖已有的 `.log.bak`，永远只保留一份备份。

**建议修复**：将轮转操作移入 `locked_append` 的锁保护范围内，或在 `hook_utils.py` 中提供带锁的轮转接口。若仅保持单备份，至少增加时间戳后缀：

```python
bak = LOG_FILE.with_name(f"{LOG_FILE.stem}.{ts_utc().replace(':', '')}.log.bak")
```

---

#### N3. `str()` 强转路径字段，可能掩盖类型校验异常

**位置**：第 188 行

```python
path_str: str = (str(tool_input.get("path") or "")).strip()
```

原代码（修复前）为：

```python
path_str: str = (tool_input.get("path") or "").strip()
```

若 `path` 字段值为非字符串类型（如 `{"path": ["/etc/passwd", "/tmp"]}`），原代码会触发 `AttributeError`，由 R1 修复后的 Fail-Safe 顶层捕获并拒绝。

新代码的 `str()` 包装会将列表转为字符串 `"['/etc/passwd', '/tmp']"`，这既不匹配任何规则，也不会拒绝，实际行为变成**无声放行了一次格式异常的请求**。

**建议修复**：先做类型检查，非字符串类型应视为无效路径直接放行（或按 Fail-Safe 逻辑拒绝）：

```python
raw_path = tool_input.get("path")
if not isinstance(raw_path, str):
    stdout_allow()
    return
path_str: str = raw_path.strip()
```

---

#### N4. R9 建议的 `docker-compose.override.yml` 模式未添加

**位置**：`_SENSITIVE_PATTERNS`（缺失）

上一轮报告建议在 R9 中补充 `docker-compose.override.yml`（本地覆盖配置通常含数据库密码），但当前代码的修复记录（`R9 - 补充敏感文件模式：*.tfvars、*.asc、.pgpass、.netrc、.npmrc、*.p8`）中未包含此项，属于遗漏。

**建议补充**：

```python
(r"^docker-compose\.override\.(yml|yaml)$",
 "Docker Compose 本地覆盖配置（常含数据库密码等敏感配置）"),
```

---

## 第三部分：设计亮点（保持不变）

以下设计值得肯定：

- ✅ **R1 Fail-Safe**：顶层异常路径改为 `deny`，防止构造异常输入绕过防护
- ✅ **`_WRITE_TOOLS` frozenset**：O(1) 查找 + 不可变，比原 `in (...)` 元组更规范
- ✅ **正则预编译**：`_compiled_patterns` 模块加载时完成，运行时无重复开销
- ✅ **仅匹配 basename**：避免路径前缀（如 `/usr/local/token-cli`）误报
- ✅ **R3 负向后瞻/前瞻**：`(?<![a-z])secrets?(?![a-z])` 比 `\b` 更精确（`\b` 将 `_` 视为词字符）
- ✅ **文件锁保护日志**：`FileLock` 防止并发写入竞争
- ✅ **文档注释同步更新**：修复记录 R1–R10 写入模块 docstring，可追溯性良好

---

## 修复优先级汇总

### 上轮问题（全部已修复）

| # | 问题 | 状态 |
|---|---|---|
| R1–R10 | 见第一部分 | ✅ 全部已修复 |

### 本轮新问题

| # | 问题 | 严重程度 | 建议优先级 |
|---|---|---|---|
| N1 | JSON 解析失败仍 Fail-Open | 🟠 中危 | P1 — 近期修复 |
| N2 | 日志轮转存在竞态条件 | 🟡 低危 | P2 — 可选 |
| N3 | `str()` 强转掩盖类型校验异常 | 🟡 低危 | P2 — 可选 |
| N4 | `docker-compose.override.yml` 规则遗漏 | 🟡 低危 | P2 — 可选 |

---

*首次报告：2026-06-30T10:59 (UTC+8)*  
*本次更新：2026-06-30T11:21 (UTC+8)*

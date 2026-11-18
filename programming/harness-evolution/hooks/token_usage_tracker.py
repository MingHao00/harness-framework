#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import json
import traceback
from pathlib import Path

HOOK_UTILS_DIR = Path(__file__).resolve().parents[2] / "security" / "hooks"
if str(HOOK_UTILS_DIR) not in sys.path:
    sys.path.insert(0, str(HOOK_UTILS_DIR))

from hook_utils import ts_local, today, append_jsonl, locked_append, stdout_allow, sanitize_path

LOG_DIR = Path(__file__).parent.parent / ".cursor" / "logs"

# 定价单位：每 1K tokens（美元）
# 格式：(input_per_1k, output_per_1k)
PRICING = {
    # OpenAI
    "gpt-4o":            (0.0025,   0.01),
    "gpt-4o-mini":       (0.00015,  0.0006),
    "gpt-4-turbo":       (0.01,     0.03),
    "gpt-4":             (0.03,     0.06),
    "gpt-3.5-turbo":     (0.0005,   0.0015),
    # OpenAI Reasoning
    "o1":                (0.015,    0.06),
    "o1-mini":           (0.003,    0.012),
    "o1-preview":        (0.015,    0.06),
    "o3":                (0.01,     0.04),
    "o3-mini":           (0.0011,   0.0044),
    "o4-mini":           (0.0011,   0.0044),
    # Anthropic Claude
    "claude-opus-4":     (0.015,    0.075),
    "claude-sonnet-4":   (0.003,    0.015),
    "claude-3-7-sonnet": (0.003,    0.015),
    "claude-3-5-sonnet": (0.003,    0.015),
    "claude-3-5-haiku":  (0.0008,   0.004),
    "claude-3-opus":     (0.015,    0.075),
    "claude-3-sonnet":   (0.003,    0.015),
    "claude-3-haiku":    (0.00025,  0.00125),
    # Google Gemini
    "gemini-2.5-pro":    (0.00125,  0.01),   # ≤200K tokens 档位
    "gemini-2.0-flash":  (0.0001,   0.0004),
    "gemini-1.5-pro":    (0.00125,  0.005),
    "gemini-1.5-flash":  (0.000075, 0.0003),
}

# 精确匹配优先顺序（防止 gpt-4 误匹配 gpt-4o）
_MATCH_PRIORITY = [
    "gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4",
    "claude-opus-4", "claude-sonnet-4", "claude-3-7-sonnet",
    "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus",
    "claude-3-sonnet", "claude-3-haiku",
    "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash",
    "o4-mini", "o3-mini", "o3", "o1-mini", "o1-preview", "o1",
    "gpt-3.5-turbo",
]


def _log_path():
    return LOG_DIR / f"token_usage_{today()}.log"


def _match_price(model: str):
    if not model:
        return None
    key = model.lower()
    if key in PRICING:
        return PRICING[key]
    for name in _MATCH_PRIORITY:
        if name in key:
            return PRICING[name]
    return None


def _calc_cost(model, input_tokens, output_tokens):
    price = _match_price(model)
    if price is None:
        return None, "unknown_model"
    in_price, out_price = price
    cost = (input_tokens / 1000) * in_price + (output_tokens / 1000) * out_price
    return round(cost, 6), None


def _get(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d:
            return d[k]
    return default


def _extract_usage(data):
    usage = _get(data, "usage", "tokenUsage", "token_usage", default={}) or {}
    input_tokens = int(_get(usage, "inputTokens", "input_tokens", "prompt_tokens",
                            "promptTokens", default=0) or 0)
    output_tokens = int(_get(usage, "outputTokens", "output_tokens", "completion_tokens",
                             "completionTokens", default=0) or 0)
    total = int(_get(usage, "totalTokens", "total_tokens", default=0) or 0)
    if total == 0 and (input_tokens or output_tokens):
        total = input_tokens + output_tokens
    return input_tokens, output_tokens, total, len(usage) == 0


def _session_exists_in_file(f, session_id: str) -> bool:
    f.seek(0)
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if obj.get("sessionId") == session_id:
                return True
        except Exception:
            continue
    return False


def _write_entry(entry: dict):
    log_path = _log_path()
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    session_id = entry.get("sessionId")

    if session_id:
        # TOCTOU 修复：在锁内完成检查+写入，"a+" 模式支持读写
        from hook_utils import locked_append as _locked
        try:
            with _locked(log_path, mode="a+") as f:
                if _session_exists_in_file(f, session_id):
                    entry["entryType"] = "update"
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            raise
    else:
        append_jsonl(log_path, entry)


def main():
    raw = sys.stdin.read()

    if not raw.strip():
        stdout_allow()
        return

    try:
        data = json.loads(raw)
    except Exception:
        stdout_allow()
        return

    session_id = _get(data, "sessionId", "session_id", "id", default=None)
    model = _get(data, "model", "modelId", "model_id", "modelName", default=None)
    if not model:
        model = str(_get(data, "llm", default="")) or None
    project_path = _get(data, "workspacePath", "projectPath", "workspace", default=None)

    input_tokens, output_tokens, total_tokens, missing_usage = _extract_usage(data)
    estimated_cost, cost_marker = _calc_cost(model or "", input_tokens, output_tokens)

    entry = {
        "sessionId": session_id,
        "model": model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
        "estimatedCostUSD": estimated_cost if estimated_cost is not None else cost_marker,
        "sessionEndTime": ts_local(),
        "entryType": "record",
    }

    if project_path:
        entry["projectName"] = sanitize_path(project_path)
    if missing_usage:
        entry["warnings"] = ["usage fields not found in payload"]

    try:
        _write_entry(entry)
    except Exception as e:
        sys.stderr.write(f"[token_usage_tracker] 日志写入失败: {e}\n{traceback.format_exc()}")
        sys.stderr.flush()

    stdout_allow()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        stdout_allow()

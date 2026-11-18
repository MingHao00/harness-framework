#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import json
import re
import traceback
import unicodedata
from pathlib import Path

from hook_utils import ts_utc, append_jsonl, stdout_allow, stdout_deny

LOG_FILE = Path(__file__).parent.parent / ".cursor" / "logs" / "injection_guard.log"
MAX_TEXT_LEN = 10000
MAX_DEPTH = 20
MAX_RESULTS = 500

# 命中即拒绝的规则
DENY_PATTERNS = [
    # 系统指令覆盖
    r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|rules?|constraints?)",
    r"disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|rules?)",
    r"forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|prompts?|context|rules?)",
    r"(忽略|无视|抛弃|丢弃|不管)\s*(之前|以前|上面|前面|所有)?(的|所有)?\s*(指令|提示|规则|系统|约束|限制|上下文)",
    r"(覆盖|篡改|修改|替换)\s*(系统|原始)?\s*(提示|指令|规则)",
    # 系统提示泄露
    r"(reveal|show|print|repeat)\s+(your\s+)?(system\s+prompt|initial\s+prompt|original\s+prompt|initial\s+instructions?)",
    r"(系统提示|系统指令|原始提示|初始提示|内部提示)\s*(是|为|：|:)",
    # 越狱
    r"\bDAN\s*(mode|模式)?\b",
    r"developer\s+mode\b",
    r"jailbreak",
    r"你现在是.{0,20}模式",
    r"(now\s+you\s+are|you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are))\s+.{0,30}(without\s+(any\s+)?(restrictions?|limits?|guidelines?|rules?|constraints?)|unrestricted|free\s+from)",
    r"(开发者模式|无限制模式|越狱模式|root\s*模式)",
    # 敏感凭据诱导（需要"泄露/暴露"动词上下文，降低误报）
    r"(show|reveal|leak|expose|dump)\s+(all\s+)?(your\s+)?(secret|credential|password|private[\s_-]?key)",
    r"(泄露|暴露)\s*(你的|系统的|所有的|内部的)?\s*(密钥|token|配置|凭据|密码|私钥)",
    # 分隔符注入
    r"<\|?(im_start|im_end|system|user|assistant|endofprompt|endoftext)\|?>",
    r"\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>",
    r"###\s*(system|instruction|override|injected)",
    # 零宽字符
    r"[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\ufeff]",
    # 角色扮演式注入
    r"(suppose|imagine|hypothetically|in\s+a\s+fictional|in\s+this\s+scenario).{0,50}(ignore|bypass|override|disregard).{0,50}(rule|restriction|guideline|policy|constraint)",
    r"(假设|想象|虚构|假如).{0,30}(忽略|绕过|不受|无视).{0,30}(规则|限制|约束|策略)",
    # 提示词终止符注入
    r"---+\s*(new\s+instruction|system\s+message|override)",
]

# 仅记录警告、不拒绝的规则（高误报风险）
WARN_PATTERNS = [
    r"(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|bearer\s+token)",
    r"(internal\s+config|internal\s+setting|system\s+config|environment\s+variable)",
    r"(no\s+restrictions?|no\s+limits?|without\s+restrictions?|bypass\s+(safety|filter|restriction|guideline))",
    r"(show|print|output)\s+(all\s+)?(your\s+)?(token|key|config)",
    r"(告诉我|输出)\s*(你的|系统的|所有的|内部的)?\s*(密钥|API|token|配置)",
]

_deny_compiled = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in DENY_PATTERNS]
_warn_compiled = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in WARN_PATTERNS]


def _normalize(text: str) -> str:
    # Unicode NFKC 归一化：全角→半角、同形字合并
    normalized = unicodedata.normalize("NFKC", text)
    # 移除零宽字符后再做后续匹配（零宽字符规则已在 DENY_PATTERNS 中单独检测原文）
    normalized = re.sub(r"[\u200b-\u200f\u202a-\u202e\ufeff]", "", normalized)
    return normalized


def _log(level, msg):
    entry = {"time": ts_utc(), "level": level, "msg": msg}
    try:
        append_jsonl(LOG_FILE, entry)
    except Exception as e:
        sys.stderr.write(f"[injection_guard] 日志写入失败: {e}\n")
        sys.stderr.flush()


def extract_texts(obj, results=None, depth=0):
    if results is None:
        results = []
    if depth > MAX_DEPTH or len(results) >= MAX_RESULTS:
        return results
    if isinstance(obj, str):
        results.append(obj[:MAX_TEXT_LEN])
    elif isinstance(obj, dict):
        for v in obj.values():
            extract_texts(v, results, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            extract_texts(item, results, depth + 1)
    return results


def check_patterns(text, compiled_list):
    for pattern in compiled_list:
        m = pattern.search(text)
        if m:
            return m.group(0)[:120]
    return None


def main():
    raw = sys.stdin.read()

    # 空 stdin：Cursor 探测请求，放行
    if not raw.strip():
        _log("WARN", "stdin 为空，放行（可能为探测请求）")
        stdout_allow()
        return

    try:
        data = json.loads(raw)
    except Exception as e:
        _log("ERROR", f"JSON 解析失败: {e}，拒绝通过")
        stdout_deny(
            "[提示词注入防护] 您的请求包含违反安全策略的内容，已被拦截。请修改后重试。",
            f"[injection_guard] 请求被拒绝。输入 JSON 格式非法，无法完成安全校验: {e}",
        )
        return

    event_type = (
        data.get("event") or data.get("type") or
        data.get("hookEvent") or data.get("eventName") or "unknown"
    )

    if not isinstance(data.get("userMessage"), str):
        _log("WARN", f"event={event_type} payload 缺少必填字段 userMessage 或类型非字符串")

    texts = extract_texts(data)

    for text in texts:
        # 先在原文上检测零宽字符等原始注入
        raw_hit = check_patterns(text, _deny_compiled)
        if raw_hit:
            summary = repr(raw_hit[:80])
            _log("INFO", f"event={event_type} decision=deny hit={summary}")
            stdout_deny(
                "[提示词注入防护] 您的请求包含违反安全策略的内容，已被拦截。请修改后重试。",
                f"[injection_guard] 请求被拒绝。检测到潜在提示词注入，命中规则摘要: {summary}",
            )
            return

        # 在归一化文本上再次检测（防全角/同形字绕过）
        normalized = _normalize(text)
        if normalized != text:
            norm_hit = check_patterns(normalized, _deny_compiled)
            if norm_hit:
                summary = repr(norm_hit[:80])
                _log("INFO", f"event={event_type} decision=deny source=normalized hit={summary}")
                stdout_deny(
                    "[提示词注入防护] 您的请求包含违反安全策略的内容，已被拦截。请修改后重试。",
                    f"[injection_guard] 请求被拒绝（归一化后命中）。命中规则摘要: {summary}",
                )
                return

        # 高误报规则：仅记录警告
        warn_hit = check_patterns(normalized, _warn_compiled)
        if warn_hit:
            _log("WARN", f"event={event_type} warn_pattern hit={repr(warn_hit[:80])}")

    _log("INFO", f"event={event_type} decision=allow")
    stdout_allow()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        tb = traceback.format_exc()
        _log("ERROR", f"未预期异常: {tb}")
        sys.stderr.write(tb)
        stdout_deny(
            "[提示词注入防护] 您的请求包含违反安全策略的内容，已被拦截。请修改后重试。",
            "[injection_guard] Hook 内部异常，请求已被安全策略拒绝",
        )
        sys.exit(0)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from typing import IO, Generator

from filelock import FileLock, Timeout


def configure_utf8_streams() -> None:
    """强制 stdout/stderr (stdin is now read as raw bytes via .buffer) 使用 UTF-8，修正 Windows GBK/CP936 默认编码。

    设计为按需调用的函数（不在模块加载时自动执行），避免在测试框架中
    因 sys.stdout 被替换为不完全兼容的对象（如 pytest capsys）而触发
    AttributeError 或 io.UnsupportedOperation。
    各 Hook 脚本应在 __main__ 读取 stdin 之前调用此函数。
    """
    for stream in (sys.stdout, sys.stderr):  # stdin is read as raw bytes via .buffer
        try:
            stream.reconfigure(encoding="utf-8", errors="surrogateescape")
        except (AttributeError, OSError):
            # AttributeError: 流对象无 reconfigure 方法（非 TextIOWrapper）
            # OSError: 覆盖 io.UnsupportedOperation（其父类之一），流不支持重配置
            pass


def ts_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ts_local() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


@contextmanager
def locked_append(log_path: Path, timeout: float = 10.0, mode: str = "a") -> Generator[IO[str], None, None]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = log_path.with_suffix(".lock")
    lock = FileLock(str(lock_path), timeout=timeout)
    try:
        with lock:
            with open(log_path, mode, encoding="utf-8") as f:
                yield f
    except Timeout:
        sys.stderr.write(f"[hook_utils] 获取文件锁超时: {lock_path}\n")
        sys.stderr.flush()
        raise


def append_jsonl(log_path: Path, entry: dict, lock_timeout: float = 10.0) -> None:
    with locked_append(log_path, timeout=lock_timeout) as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def stdout_allow() -> None:
    sys.stdout.write('{"permission":"allow"}\n')
    sys.stdout.flush()


def stdout_ask(user_message: str, agent_message: str) -> None:
    out = {
        "permission": "ask",
        "user_message": user_message,
        "agent_message": agent_message,
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def stdout_deny(user_message: str, agent_message: str) -> None:
    out = {
        "permission": "deny",
        "user_message": user_message,
        "agent_message": agent_message,
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sanitize_path(path_str: str) -> str:
    if not path_str:
        return path_str
    return Path(path_str).name

"""Filesystem locations. The project sits in a deep folder on Windows (path > 260 chars),
so file access goes through the \\\\?\\ long-path prefix; runtime data lives in a short folder."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def long(p: str | os.PathLike) -> str:
    s = os.path.abspath(os.fspath(p))
    if sys.platform == "win32" and not s.startswith("\\\\?\\"):
        return "\\\\?\\" + s
    return s


def read_text(p) -> str:
    with open(long(p), encoding="utf-8-sig") as f:
        return f.read()


def read_bytes(p) -> bytes:
    with open(long(p), "rb") as f:
        return f.read()


ROOT = Path(os.path.abspath(__file__)).parent.parent          # spendsentinel/
DATA = ROOT / "public" / "data"
# SQLite and snapshots: short path outside the deep project folder.
HOME = Path(os.environ.get("SPENDSENTINEL_HOME", Path.home() / ".spendsentinel"))
HOME.mkdir(parents=True, exist_ok=True)

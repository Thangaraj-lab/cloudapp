"""Local LLM wording with guardrails. The engine decides; the model only words.
Input is structured engine facts (never raw billing rows). Every number in the output
must be one of the fact numbers, otherwise the template sentence is returned."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("SPENDSENTINEL_LLM", "llama3.2:3b")
TIMEOUT = float(os.environ.get("SPENDSENTINEL_LLM_TIMEOUT", "15"))
# Numbers that stand alone (not the "2" in "EC2" or the "3" in "t3").
NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?(?![A-Za-z])")


def status() -> dict:
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=2) as r:
            models = [m["name"] for m in json.load(r).get("models", [])]
        return {"ok": True, "endpoint": OLLAMA, "model": MODEL, "available": MODEL in models, "models": models}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "endpoint": OLLAMA, "model": MODEL, "error": str(e)[:120]}


def _numbers(s: str) -> set[str]:
    out = set()
    for n in NUM.findall(s):
        v = n.replace(",", "")
        try:
            f = float(v)
        except ValueError:
            continue
        out |= {f"{f:.2f}", f"{f:.0f}", f"{f:.1f}", v}
    return out


def check(text: str, facts: dict) -> bool:
    allowed = set()
    for v in facts.values():
        allowed |= _numbers(str(v))
    for n in NUM.findall(text):
        v = n.replace(",", "")
        if v not in allowed and f"{float(v):.2f}" not in allowed:
            return False
    return True


def narrate(facts: dict, template: str) -> dict:
    prompt = ("You write one plain sentence (max 30 words) for a cloud cost dashboard. Use ONLY these facts; "
              "copy numbers exactly as given; do not add numbers, causes or advice that are not in the facts.\n"
              f"Facts: {json.dumps(facts)}\nSentence:")
    t0 = time.time()
    try:
        req = urllib.request.Request(OLLAMA + "/api/generate", data=json.dumps({
            "model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.2, "num_predict": 70}}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            text = json.load(r).get("response", "").strip().split("\n")[0].strip().strip('"')
    except Exception as e:  # noqa: BLE001
        return {"text": template, "source": "template", "reason": f"model unavailable ({str(e)[:80]})", "ms": int((time.time() - t0) * 1000)}
    ms = int((time.time() - t0) * 1000)
    if not text or not check(text, facts):
        return {"text": template, "source": "template", "reason": "model output had numbers not in the facts", "rejected": text, "ms": ms}
    return {"text": text, "source": "llm", "model": MODEL, "ms": ms}

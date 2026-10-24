"""Hash chain, approval tokens, policy, model signing. Stdlib only; wire-compatible with
src/engine/approval.ts (same token format, same pairing-key derivation)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

TTL_MS = 10 * 60 * 1000
GENESIS = "0" * 64


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def hmac_hex(key: str, msg: str) -> str:
    return hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def canonical(v) -> str:
    """Sorted-key compact JSON (the hash input for audit entries and signed models)."""
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------- audit chain

def hash_entry(e: dict) -> str:
    base = {k: e[k] for k in ("i", "ts", "actor", "event", "payload", "prevHash")}
    return sha256_hex(e["prevHash"] + canonical(base))


def append(chain: list[dict], actor: str, event: str, payload, ts: int | None = None) -> dict:
    prev = chain[-1]["hash"] if chain else GENESIS
    e = {"i": len(chain), "ts": ts if ts is not None else int(time.time() * 1000), "actor": actor, "event": event, "payload": payload, "prevHash": prev}
    e["hash"] = hash_entry(e)
    chain.append(e)
    return e


def verify_chain(chain: list[dict]) -> dict:
    prev = GENESIS
    for e in chain:
        if e["prevHash"] != prev or hash_entry(e) != e["hash"]:
            return {"ok": False, "brokenAt": e["i"]}
        prev = e["hash"]
    return {"ok": True, "n": len(chain)}


# ---------------------------------------------------------------- approvals

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_pairing_code() -> str:
    return "".join(ALPHABET[b % len(ALPHABET)] for b in os.urandom(8))


def pairing_key(code: str) -> str:
    return sha256_hex("spendsentinel-pairing:" + code.strip().upper())


def _b64(s: str) -> str:
    return base64.b64encode(s.encode("utf-8")).decode().rstrip("=")


def _unb64(s: str) -> str:
    return base64.b64decode(s + "=" * (-len(s) % 4)).decode("utf-8")


def request(finding_id: str, action: str, state_hash: str, device_id: str, now_ms: int | None = None) -> str:
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    payload = {"findingId": finding_id, "action": action, "stateHash": state_hash, "deviceId": device_id,
               "nonce": os.urandom(16).hex(), "issuedAt": now, "expiresAt": now + TTL_MS}
    return _b64(json.dumps(payload, separators=(",", ":")))


def sign(key: str, body: str) -> str:
    return body + "." + hmac_hex(key, body)


def short_code(token: str) -> str:
    return token.split(".")[1][:8].upper()


def decode(token: str) -> dict | None:
    try:
        return json.loads(_unb64(token.strip().split(".")[0]))
    except Exception:
        return None


def verify(key: str, token: str, used_nonces: set[str], finding_id: str, state_hash: str, now_ms: int | None = None) -> dict:
    parts = token.strip().split(".")
    if len(parts) != 2 or not all(parts):
        return {"ok": False, "reason": "Malformed token."}
    body, sig = parts
    if not hmac.compare_digest(hmac_hex(key, body), sig):
        return {"ok": False, "reason": "Signature mismatch: token was tampered with or signed by an unpaired device."}
    p = decode(token)
    if not p:
        return {"ok": False, "reason": "Unreadable payload."}
    if (now_ms if now_ms is not None else int(time.time() * 1000)) > p["expiresAt"]:
        return {"ok": False, "reason": "Token expired (10 minute TTL)."}
    if p["nonce"] in used_nonces:
        return {"ok": False, "reason": "Token already used (single-use nonce replay blocked)."}
    if p["findingId"] != finding_id:
        return {"ok": False, "reason": "Token was issued for a different finding."}
    if p["stateHash"] != state_hash:
        return {"ok": False, "reason": "Stale approval: the cost state changed since this was signed."}
    return {"ok": True, "payload": p}


# ---------------------------------------------------------------- policy

DEFAULT_POLICY = {"autoApply": False, "maxActionCostPerDay": 50.0, "blockProd": True, "requireRollbackPlan": True}


def evaluate(policy: dict, environment: str, daily_cost: float, has_rollback: bool) -> dict:
    if policy["blockProd"] and environment.lower().startswith("prod"):
        return {"result": "deny", "needsSecond": False, "reasons": ["Your policy never changes production-tagged resources."]}
    if policy["requireRollbackPlan"] and not has_rollback:
        return {"result": "deny", "needsSecond": False, "reasons": ["Your policy requires a rollback plan."]}
    needs_second = daily_cost > policy["maxActionCostPerDay"]
    reasons = [f"Affects about ${daily_cost:.2f}/day, above the ${policy['maxActionCostPerDay']:.2f}/day limit: a second approver must sign."] if needs_second else []
    reasons.append("Approve-first: a named person signs every change.")
    return {"result": "needs-approval", "needsSecond": needs_second, "reasons": reasons}


# ---------------------------------------------------------------- signed model JSON

def sign_model(model: dict, key: str) -> dict:
    """HMAC over the canonical model body; the phone verifies before using it."""
    body = {k: v for k, v in model.items() if k != "signature"}
    return {**body, "signature": hmac_hex(key, canonical(body))}


def verify_model(model: dict, key: str) -> bool:
    sig = model.get("signature", "")
    body = {k: v for k, v in model.items() if k != "signature"}
    return hmac.compare_digest(hmac_hex(key, canonical(body)), sig)

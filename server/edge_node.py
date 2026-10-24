"""SpendSentinel edge node (runs on the phone in Termux; also runs on the laptop for testing).

    python edge_node.py --laptop http://192.168.42.10:8787 --code ABCD2345

Same engine/ code as the laptop API. The phone initiates every connection:
  - pulls the canonical dataset and analyses it locally  (GET  /api/dataset.csv)
  - heartbeat every 5 s                                    (POST /api/edge/heartbeat)
  - pulls the signed verdict model, verifies before use    (GET  /api/model)
  - pushes an encrypted ledger/audit snapshot every 60 s   (POST /api/edge/snapshot)
Local API on :8080 — GET /health, /findings, /narrate?id=… (llama.cpp on :8081 if running).
Stdlib only, plus `cryptography` for AES-GCM snapshots when installed (pkg install python-cryptography).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from engine import trust
from engine.core import analyze, parse_csv
from engine.model import TreeModel

STATE = {"findings": [], "rows": 0, "model": None, "modelVersion": None, "lastSync": None, "laptopOnline": False, "log": []}
HOME = os.path.expanduser(os.environ.get("SPENDSENTINEL_EDGE_HOME", "~/.spendsentinel-edge"))
os.makedirs(HOME, exist_ok=True)
DB = sqlite3.connect(os.path.join(HOME, "edge.db"), check_same_thread=False)
DB.execute("create table if not exists audit (i integer primary key, doc text)")
DB.execute("create table if not exists kv (k text primary key, v text)")
LOCK = threading.Lock()


def note(msg: str) -> None:
    STATE["log"] = ([f"{time.strftime('%H:%M:%S')} {msg}"] + STATE["log"])[:50]
    print(msg, flush=True)


def audit(event: str, payload: dict) -> None:
    with LOCK:
        chain = [json.loads(r[0]) for r in DB.execute("select doc from audit order by i")]
        e = trust.append(chain, "edge@phone", event, payload)
        DB.execute("insert into audit values (?, ?)", (e["i"], json.dumps(e)))
        DB.commit()


def http(method: str, url: str, body=None, timeout=4):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if r.headers.get_content_type() == "application/json" else raw.decode("utf-8")


def battery() -> int | None:
    try:
        out = subprocess.run(["termux-battery-status"], capture_output=True, text=True, timeout=3).stdout
        return json.loads(out).get("percentage")
    except Exception:  # noqa: BLE001  (not on Termux, or Termux:API missing)
        return None


# ---------------------------------------------------------------- sync loops

def sync_dataset(laptop: str) -> None:
    csv = http("GET", laptop + "/api/dataset.csv", timeout=15)
    digest = hashlib.sha256(csv.encode()).hexdigest()[:12]
    if digest == STATE.get("digest"):
        return
    rows = parse_csv(csv).rows
    model = TreeModel(STATE["model"]) if STATE["model"] and STATE["model"].get("kind") == "decision-tree" else None
    a = analyze(rows, model=model)
    STATE.update(findings=a["findings"], rows=len(rows), digest=digest, lastSync=time.time())
    with open(os.path.join(HOME, "dataset.csv"), "w", encoding="utf-8") as f:
        f.write(csv)
    audit("dataset synced", {"rows": len(rows), "findings": len(a["findings"]), "digest": digest})
    note(f"dataset synced: {len(rows)} rows, {len(a['findings'])} findings (computed on this device)")


def pull_model(laptop: str, key: str) -> None:
    m = http("GET", laptop + "/api/model")
    if m.get("kind") != "decision-tree":
        return
    if not trust.verify_model(m, key):
        audit("model rejected", {"version": m.get("version"), "reason": "bad signature"})
        note("model REJECTED: signature does not match the paired key")
        return
    if m.get("version") != STATE["modelVersion"]:
        STATE.update(model=m, modelVersion=m.get("version"), digest=None)
        audit("model accepted", {"version": m.get("version"), "trainedOn": m.get("trainedOn")})
        note(f"model v{m.get('version')} verified and loaded")


def encrypt_snapshot(code: str, device: str) -> dict:
    with LOCK:
        chain = [json.loads(r[0]) for r in DB.execute("select doc from audit order by i")]
    plain = json.dumps({"audit": chain[-200:], "verify": trust.verify_chain(chain), "at": time.time()}).encode()
    salt = os.urandom(16)
    k = hashlib.scrypt((code + ":" + device).encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = os.urandom(12)
        ct = AESGCM(k).encrypt(nonce, plain, device.encode())
        return {"alg": "AES-256-GCM/scrypt", "salt": base64.b64encode(salt).decode(), "nonce": base64.b64encode(nonce).decode(), "ciphertext": base64.b64encode(ct).decode()}
    except ImportError:
        # Without `cryptography` the snapshot is only integrity-protected, and says so.
        return {"alg": "none (install python-cryptography for AES-GCM)", "hmac": trust.hmac_hex(k.hex(), plain.decode()), "ciphertext": base64.b64encode(plain).decode()}


LAPTOP = {"url": ""}
DB.execute("create table if not exists outbox (id integer primary key, finding_id text, token text, queued_at integer, status text, result text)")
DB.commit()
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def proxy(method: str, path: str, body: bytes | None = None, timeout=6):
    """Pass a request through to the laptop API. Returns (status, content-type, bytes)."""
    req = urllib.request.Request(LAPTOP["url"] + path, data=body, method=method, headers={"Content-Type": "application/json", "X-Forwarded-For": "edge"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", "application/json"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "application/json"), e.read()


def flush_outbox() -> None:
    """Approvals signed while the laptop was unreachable are delivered as soon as it is back."""
    with LOCK:
        rows = DB.execute("select id, finding_id, token from outbox where status='queued' order by id").fetchall()
    for oid, fid, token in rows:
        try:
            status, _, raw = proxy("POST", "/api/approvals/consume", json.dumps({"findingId": fid, "token": token}).encode())
        except Exception:  # noqa: BLE001  (laptop gone again)
            return
        res = raw.decode("utf-8", "replace")
        state = "sent" if status == 200 else "refused"
        with LOCK:
            DB.execute("update outbox set status=?, result=? where id=?", (state, res[:500], oid))
            DB.commit()
        audit("queued approval " + state, {"findingId": fid, "status": status})
        note(f"queued approval for {fid}: {state} ({res[:80]})")


def outbox() -> list[dict]:
    with LOCK:
        rows = DB.execute("select id, finding_id, queued_at, status, result from outbox order by id desc limit 20").fetchall()
    return [{"id": r[0], "findingId": r[1], "queuedAt": r[2], "status": r[3], "result": r[4]} for r in rows]


def loops(laptop: str, code: str, device: str) -> None:
    key = trust.pairing_key(code)
    last_model = last_snap = 0.0
    while True:
        try:
            r = http("POST", laptop + "/api/edge/heartbeat", {"deviceId": device, "battery": battery(), "findings": len(STATE["findings"]),
                                                             "modelVersion": STATE["modelVersion"], "rows": STATE["rows"],
                                                             "queued": sum(1 for o in outbox() if o["status"] == "queued")})
            if not STATE["laptopOnline"]:
                note(f"laptop reachable at {laptop}")
                audit("laptop online", {"laptop": laptop})
            STATE["laptopOnline"] = True
            STATE["pendingApprovals"] = r.get("pendingApprovals", 0)
            # Keep what the phone needs to keep working offline.
            STATE["health"] = http("GET", laptop + "/api/health")
            STATE["pending"] = http("GET", laptop + "/api/approvals/pending").get("pending", [])
            with LOCK:  # survives an edge restart with the laptop away
                DB.execute("insert or replace into kv values ('cache', ?)", (json.dumps({"health": STATE["health"], "pending": STATE["pending"]}),))
                DB.commit()
            flush_outbox()
            now = time.time()
            if now - last_model > 60:
                pull_model(laptop, key)
                sync_dataset(laptop)
                last_model = now
            if now - last_snap > 60:
                blob = encrypt_snapshot(code, device)
                http("POST", laptop + "/api/edge/snapshot", {"deviceId": device, **blob}, timeout=10)
                last_snap = now
        except Exception as e:  # noqa: BLE001
            if STATE["laptopOnline"]:
                note(f"laptop unreachable ({str(e)[:80]}); working offline with the last dataset")
                audit("laptop offline", {})
            STATE["laptopOnline"] = False
        time.sleep(5)


# ---------------------------------------------------------------- local API

def narrate_local(fid: str) -> dict:
    f = next((x for x in STATE["findings"] if x["finding"]["id"] == fid), None)
    if not f:
        return {"error": "unknown finding"}
    tp = f["explanation"]["topPath"]
    facts = {"service": tp["service"], "environment": tp["environment"], "extra_per_day_usd": f"{max(0.0, tp['add']):.2f}", "day": f["finding"]["day"], "verdict": f["verdict"]["kind"]}
    t0 = time.time()
    try:
        prompt = f"One plain sentence (max 25 words) using only these facts, numbers copied exactly: {json.dumps(facts)}\nSentence:"
        out = http("POST", "http://127.0.0.1:8081/completion", {"prompt": prompt, "n_predict": 60, "temperature": 0.2}, timeout=5)
        text = out.get("content", "").strip().split("\n")[0]
        import narrator  # same guardrail as the laptop
        if text and narrator.check(text, facts):
            return {"text": text, "source": "llama.cpp on phone", "ms": int((time.time() - t0) * 1000)}
        return {"text": f["headline"], "source": "template", "reason": "number check failed", "rejected": text}
    except Exception as e:  # noqa: BLE001
        return {"text": f["headline"], "source": "template", "reason": f"no local model ({str(e)[:60]})", "ms": int((time.time() - t0) * 1000)}


def offline_health() -> dict:
    h = dict(STATE.get("health") or {})
    return {**h, "ok": True, "offline": True, "engine": "python (phone)", "cloud": {"ok": False, "mode": "laptop unreachable", "endpoint": LAPTOP["url"], "bucket": ""},
            "llm": {"ok": False, "model": "", "available": False}, "edge": {"online": True, "deviceId": "this phone", "local": True},
            "pairingHash": h.get("pairingHash", ""), "pairedPhone": h.get("pairedPhone"),
            "dataset": h.get("dataset"), "model": h.get("model") or {"active": False, "trainedOn": 0, "minLabels": 20}}


MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json",
        ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".csv": "text/csv", ".ico": "image/x-icon", ".txt": "text/plain"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _raw(self, status: int, ctype: str, body: bytes, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send(self, obj, code=200):
        self._raw(code, "application/json", json.dumps(obj).encode())

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    # -- static web app (built bundle), SPA fallback to index.html
    def _static(self, path: str):
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(os.path.normpath(WEB)) or not os.path.isfile(full):
            full = os.path.join(WEB, "index.html")
        if not os.path.isfile(full):
            return self._send({"error": "web app not bundled; rerun setup"}, 404)
        with open(full, "rb") as f:
            data = f.read()
        ext = os.path.splitext(full)[1].lower()
        cache = "no-cache" if ext == ".html" or full.endswith("sw.js") else "public, max-age=31536000, immutable"
        self._raw(200, MIME.get(ext, "application/octet-stream"), data, {"Cache-Control": cache})

    def _events(self):
        # A live stream for the app; the app also polls, so keep-alives are enough offline.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(b"event: hello\ndata: {}\n\n")
            self.wfile.flush()
            for _ in range(240):
                time.sleep(15)
                self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
        except Exception:  # noqa: BLE001  (client went away)
            pass
        self.close_connection = True

    def _api(self, method: str, u):
        path = u.path
        body = self._body() if method == "POST" else None
        online = STATE["laptopOnline"]
        if path == "/api/events":
            return self._events()
        if path == "/api/dataset.csv":
            p = os.path.join(HOME, "dataset.csv")
            if os.path.exists(p):
                with open(p, "rb") as f:
                    return self._raw(200, "text/csv", f.read())
            if online:  # first run, before the sync loop has copied it
                try:
                    return self._raw(*proxy("GET", path, timeout=15))
                except Exception:  # noqa: BLE001
                    pass
            return self._send({"detail": "No dataset on this phone yet"}, 404)
        if path == "/api/edge/outbox":
            return self._send({"outbox": outbox()})
        if path == "/api/health" and not online:
            return self._send(offline_health())
        if path == "/api/approvals/pending" and not online:
            now = time.time() * 1000
            queued = {o["findingId"] for o in outbox() if o["status"] == "queued"}
            return self._send({"pending": [p for p in STATE.get("pending", []) if p["expiresAt"] > now and p["findingId"] not in queued], "offline": True})
        if path == "/api/approvals/consume":
            data = json.loads(body or b"{}")
            if online:
                try:
                    status, ctype, raw = proxy("POST", path, body)
                    return self._raw(status, ctype, raw)
                except Exception:  # noqa: BLE001  (dropped mid-request: queue it)
                    STATE["laptopOnline"] = False
            token = data.get("token")
            if not token:
                return self._send({"detail": "Offline: only a full signed approval can be queued (the 8-character code needs the laptop)."}, 503)
            with LOCK:
                DB.execute("insert into outbox (finding_id, token, queued_at, status) values (?, ?, ?, 'queued')", (data.get("findingId"), token, int(time.time() * 1000)))
                DB.commit()
            audit("approval queued offline", {"findingId": data.get("findingId")})
            note(f"laptop offline: approval for {data.get('findingId')} queued on this phone")
            return self._send({"queued": True, "actionId": None, "detail": "Saved on this phone; it is sent when the laptop is reachable."})
        if path == "/api/client-log":
            if online:
                try:
                    proxy("POST", path, body, timeout=2)
                except Exception:  # noqa: BLE001
                    pass
            return self._send({"ok": True})
        if not online:
            return self._send({"detail": "The laptop is not reachable from this phone right now."}, 503)
        try:
            status, ctype, raw = proxy(method, path + (("?" + u.query) if u.query else ""), body)
            return self._raw(status, ctype, raw)
        except Exception as e:  # noqa: BLE001
            STATE["laptopOnline"] = False
            return self._send({"detail": f"Laptop unreachable ({str(e)[:60]})"}, 503)

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            return self._api("GET", u)
        if u.path == "/health":
            with LOCK:
                chain = [json.loads(r[0]) for r in DB.execute("select doc from audit order by i")]
            return self._send({"ok": True, "role": "edge node (prototype)", "rows": STATE["rows"], "findings": len(STATE["findings"]),
                               "laptopOnline": STATE["laptopOnline"], "modelVersion": STATE["modelVersion"], "audit": trust.verify_chain(chain),
                               "outbox": outbox()[:5], "rawRowsUploaded": 0, "log": STATE["log"][:10]})
        if u.path == "/findings":
            return self._send([{"day": f["finding"]["day"], "verdict": f["verdict"]["kind"], "confidence": f["verdict"]["confidence"], "model": f["verdict"]["model"],
                                "headline": f["headline"]} for f in STATE["findings"]])
        if u.path == "/narrate":
            return self._send(narrate_local(parse_qs(u.query).get("id", [""])[0]))
        return self._static(u.path)

    def do_POST(self):  # noqa: N802
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            return self._api("POST", u)
        return self._send({"error": "not found"}, 404)

    def do_OPTIONS(self):  # noqa: N802
        self._raw(204, "text/plain", b"", {"Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"})

    def log_message(self, *_):
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--laptop", required=True, help="e.g. http://192.168.42.10:8787")
    ap.add_argument("--code", required=True, help="8-character pairing code shown on the laptop")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--device", default="phone-" + socket.gethostname()[:12])
    a = ap.parse_args()
    laptop = a.laptop.rstrip("/")
    LAPTOP["url"] = laptop
    row = DB.execute("select v from kv where k='cache'").fetchone()
    if row:
        STATE.update(json.loads(row[0]))
    # Offline start: use the last dataset if the laptop is not reachable yet.
    cached = os.path.join(HOME, "dataset.csv")
    if os.path.exists(cached):
        with open(cached, encoding="utf-8") as f:
            rows = parse_csv(f.read()).rows
        STATE.update(findings=analyze(rows)["findings"], rows=len(rows))
        note(f"loaded cached dataset: {len(rows)} rows")
    threading.Thread(target=loops, args=(laptop, a.code.strip().upper(), a.device), daemon=True).start()
    note(f"edge node {a.device} on :{a.port} · laptop {laptop}")
    note(f"open the app on this phone: http://localhost:{a.port}/#/m")
    ThreadingHTTPServer(("0.0.0.0", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()

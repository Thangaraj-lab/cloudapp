"""SpendSentinel API (laptop). Run: python -m uvicorn app:app --host 0.0.0.0 --port 8787
Engine + SQLite + local cloud (moto) + local LLM + edge node coordination."""
from __future__ import annotations

import asyncio
import json
import csv
import io
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import cloud
import events
import narrator
import store
from engine import trust
from engine.core import Params, Row, analyze, parse_csv
from engine.model import MIN_LABELS, TreeModel, train
from paths import DATA, read_bytes

EDGE_TIMEOUT = 15  # seconds without a heartbeat → edge offline


# ---------------------------------------------------------------- dataset state

def rows() -> list[Row]:
    return [Row(**r) for r in store.get("dataset_rows", [])]


def params() -> Params:
    p = store.get("params", {})
    return Params(window=int(p.get("window", 7)), z_threshold=float(p.get("zThreshold", 3.5)), min_change=float(p.get("minChange", 5)))


def model():
    m = store.get("model")
    return TreeModel(m) if m and store.get("model_active") else None


def pairing_code() -> str:
    code = store.get("pairing_code")
    if not code:
        code = trust.new_pairing_code()
        store.put("pairing_code", code)
    return code


def load_rows(rs: list[Row], source: dict) -> dict:
    store.put("dataset_rows", [r.__dict__ for r in rs])
    store.put("dataset_meta", {**source, "rows": len(rs), "loadedAt": int(time.time() * 1000)})
    lines = {(r.environment, r.application, r.service) for r in rs if any(c in r.service.lower() for c in cloud.COMPUTE)}
    seeded = cloud.seed_instances([{"environment": e, "application": a, "service": s} for e, a, s in lines])
    a = analyze(rs, params(), model())
    store.log("dataset loaded", {**source, "rows": len(rs), "findings": len(a["findings"]), "instancesSeeded": seeded})
    fired = run_rules(rs)
    events.publish("dataset", {"rows": len(rs), "findings": len(a["findings"]), "rulesFired": fired})
    return {"rows": len(rs), "findings": len(a["findings"]), "instancesSeeded": seeded, "rulesFired": fired}


def to_csv(rs: list[Row]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["day", "service", "region", "environment", "application", "billed_cost_usd"])
    for r in rs:
        w.writerow([r.day, r.service, r.region, r.environment, r.application, f"{r.cost:.10g}"])
    return buf.getvalue().encode()


def run_rules(rs: list[Row]) -> int:
    """Enabled guardrails are evaluated on every new dataset (alerts on spikes)."""
    rules = [r for r in store.get("rules", []) if r.get("enabled")]
    if not rules:
        return 0
    series = analyze(rs, params())["series"]
    fired = 0
    for r in rules:
        if r.get("kind") in ("spike-alert", "nat-spike") and len(series) > 7:
            last = series[-1]["cost"]
            prev = sorted(p["cost"] for p in series[-8:-1])[3]
            if prev > 0 and last > float(r.get("threshold", 3)) * prev:
                fired += 1
                store.log("rule fired", {"rule": r.get("name"), "day": series[-1]["day"], "ratio": round(last / prev, 2)})
    return fired


# ---------------------------------------------------------------- app

@asynccontextmanager
async def lifespan(_app: FastAPI):
    events.bind_loop(asyncio.get_running_loop())
    cloud.start()
    cloud.ensure_bucket()
    if not store.get("dataset_rows"):
        sample = read_bytes(DATA / "walkthrough_daily_by_service_region_tag.csv")
        cloud.deliver("cur/2024-09/walkthrough_daily_by_service_region_tag.csv", sample)
        load_rows(parse_csv(sample.decode("utf-8-sig")).rows, {"source": "s3", "key": "cur/2024-09/walkthrough_daily_by_service_region_tag.csv", "name": "FOCUS 1.0 public sample"})
    else:
        # The local cloud is in memory: deliver the current dataset to the bucket again.
        meta = store.get("dataset_meta") or {}
        cloud.deliver(meta.get("key") or "cur/current.csv", to_csv(rows()))
        lines = {(r.environment, r.application, r.service) for r in rows() if any(c in r.service.lower() for c in cloud.COMPUTE)}
        cloud.seed_instances([{"environment": e, "application": a, "service": s} for e, a, s in lines])
    pairing_code()
    # Load the local model in the background so the first narration is not a cold start.
    threading.Thread(target=lambda: narrator.narrate({"warmup": "1"}, ""), daemon=True).start()
    task = asyncio.create_task(edge_monitor())
    yield
    task.cancel()


async def edge_monitor():
    """Standby: 3 missed heartbeats (15 s) → the laptop marks the edge offline and keeps analysing alone."""
    while True:
        await asyncio.sleep(5)
        edge = store.get("edge")
        if edge and edge.get("online", True) and time.time() - edge.get("at", 0) >= EDGE_TIMEOUT:
            store.put("edge", {**edge, "online": False})
            store.log("edge offline: laptop standby takes over", {"deviceId": edge.get("deviceId"), "lastSeen": edge.get("at")})
            events.publish("edge", {**edge, "online": False})


app = FastAPI(title="SpendSentinel API", lifespan=lifespan)

LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "testclient"}


def laptop_only(request: Request) -> None:
    """Key and reset endpoints answer only the laptop itself. The Vite proxy forwards the
    phone's address in X-Forwarded-For, so a phone going through the proxy is refused too."""
    host = request.client.host if request.client else ""
    fwd = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    if host not in LOOPBACK or any(h not in LOOPBACK for h in fwd):
        raise HTTPException(403, "Only the laptop can do this.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    edge = store.get("edge", {})
    online = bool(edge) and time.time() - edge.get("at", 0) < EDGE_TIMEOUT
    return {"ok": True, "engine": "python", "cloud": cloud.status(), "llm": narrator.status(),
            "dataset": store.get("dataset_meta"), "edge": {**edge, "online": online}, "pairingHash": trust.sha256_hex(pairing_code())[:8], "pairedPhone": _paired_phone(),
            "model": {"active": bool(model()), "trainedOn": (store.get("model") or {}).get("trainedOn", 0), "minLabels": MIN_LABELS}}


def _paired_phone():
    """A phone that proved (by hash) it holds the current pairing code."""
    p = store.get("paired_phone")
    if not p:
        return None
    return {**p, "current": p.get("hash") == trust.sha256_hex(pairing_code())[:8]}


@app.post("/api/edge/paired")
def phone_paired(hash: str = Body(..., embed=True), device: str = Body("phone", embed=True), request: Request = None):
    ok = hash == trust.sha256_hex(pairing_code())[:8]
    if ok:
        prev = store.get("paired_phone") or {}
        store.put("paired_phone", {"hash": hash, "device": device[:60], "at": int(time.time() * 1000)})
        if prev.get("hash") != hash:
            store.log("phone paired", {"device": device[:60], "ip": request.client.host if request and request.client else None})
        events.publish("paired", {"device": device[:60]})
    return {"ok": ok}


@app.get("/api/events")
async def sse():
    return StreamingResponse(events.stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/pairing")
def get_pairing(request: Request):
    """The API owns the pairing code. Only laptop browsers may read it (to show the pairing QR)."""
    laptop_only(request)
    return {"code": pairing_code()}


@app.post("/api/pairing")
def set_pairing(request: Request, code: str = Body(..., embed=True), rotate: bool = Body(False, embed=True)):
    """Changes the code only on an explicit rotation ("New code"). Older app versions pushed their
    own code on every connect, which silently unpaired the phone; those pushes are ignored."""
    laptop_only(request)
    if not rotate:
        return {"ok": False, "ignored": True, "reason": "The API owns the pairing code; use rotate=true to change it."}
    code = code.strip().upper()
    if len(code) != 8:
        raise HTTPException(400, "Pairing code must be 8 characters")
    store.put("pairing_code", code)
    store.log("pairing code synced", {})
    return {"ok": True}


# ---------------------------------------------------------------- data

@app.get("/api/analysis")
def get_analysis():
    rs = rows()
    return {"dataset": store.get("dataset_meta"), **analyze(rs, params(), model())}


@app.get("/api/cloud/exports")
def list_exports():
    return {"bucket": cloud.BUCKET, "endpoint": cloud.ENDPOINT, "exports": cloud.exports()}


@app.post("/api/cloud/ingest")
def ingest_export(key: str | None = Body(None, embed=True)):
    ex = cloud.exports()
    if not ex:
        raise HTTPException(404, "No exports in the bucket")
    key = key or ex[0]["key"]
    pr = parse_csv(cloud.fetch(key).decode("utf-8-sig"))
    if pr.missing_columns:
        raise HTTPException(422, f"Export is missing columns: {', '.join(pr.missing_columns)}")
    res = load_rows(pr.rows, {"source": "s3", "key": key, "name": key.split("/")[-1], "quarantined": len(pr.quarantine), "duplicates": pr.duplicates})
    return {"key": key, **res, "csv": cloud.fetch(key).decode("utf-8-sig")}


@app.post("/api/datasets/rows")
def upload_rows(payload: dict = Body(...)):
    """The browser has already mapped/validated the user's file; it sends canonical daily rows.
    They are delivered to the S3 bucket (like an export) and ingested."""
    rs = [Row(r["day"], r["service"], r.get("region", "untagged"), r.get("environment", "untagged"), r.get("application", "untagged"), float(r["cost"]))
          for r in payload.get("rows", [])]
    if not rs:
        raise HTTPException(400, "No rows")
    name = payload.get("name", "upload.csv")
    key = f"uploads/{time.strftime('%Y%m%d-%H%M%S')}-{name.rsplit('.', 1)[0]}.csv"
    cloud.deliver(key, to_csv(rs))
    return {"key": key, **load_rows(rs, {"source": "upload", "key": key, "name": name})}


@app.put("/api/params")
def set_params(p: dict = Body(...)):
    store.put("params", p)
    store.log("detection changed", p)
    return {"ok": True}


# ---------------------------------------------------------------- narrator

@app.post("/api/narrate")
def narrate(findingId: str = Body(..., embed=True)):
    a = analyze(rows(), params(), model())
    f = next((x for x in a["findings"] if x["finding"]["id"] == findingId), None)
    if not f:
        raise HTTPException(404, "Unknown finding")
    tp = f["explanation"]["topPath"]
    facts = {"service": tp["service"], "environment": tp["environment"], "application": tp["application"], "day": f["finding"]["day"],
             "extra_per_day_usd": f"{max(0.0, tp['add']):.2f}", "normal_day_usd": f"{f['finding']['baselineMedian']:.2f}",
             "that_day_usd": f"{f['finding']['cost']:.2f}", "verdict": f["verdict"]["kind"], "confidence": f["verdict"]["confidence"]}
    res = narrator.narrate(facts, f["headline"])
    store.log("narration", {"findingId": findingId, "source": res["source"], "ms": res["ms"]})
    return {**res, "facts": facts}


# ---------------------------------------------------------------- approvals

def _state_hash(finding: dict) -> str:
    meta = store.get("dataset_meta") or {}
    return trust.sha256_hex(f"{finding['finding']['id']}|{finding['finding']['cost']:.4f}|{meta.get('key')}")[:16]


def _finding(fid: str) -> dict:
    a = analyze(rows(), params(), model())
    f = next((x for x in a["findings"] if x["finding"]["id"] == fid), None)
    if not f:
        raise HTTPException(404, "Unknown finding")
    return f


@app.post("/api/approvals/request")
def approval_request(findingId: str = Body(..., embed=True), device: str = Body("phone", embed=True)):
    """Laptop asks; the request appears on the paired phone (via events / polling)."""
    f = _finding(findingId)
    tp = f["explanation"]["topPath"]
    pol = trust.evaluate(store.get("policy", trust.DEFAULT_POLICY), tp["environment"], max(0.0, tp["add"]), True)
    if pol["result"] == "deny":
        store.log("approval denied by policy", {"findingId": findingId, "reasons": pol["reasons"]})
        return {"policy": pol}
    action = f"Park {tp['environment']}/{tp['application']} ({tp['service']}): snapshot, backup image, stop"
    body = trust.request(findingId, action, _state_hash(f), device[:60])
    pending = [p for p in store.get("pending", []) if p["expiresAt"] > time.time() * 1000][-9:]
    p = trust.decode(body + ".x")
    pending.append({"body": body, "findingId": findingId, "action": action, "headline": f["headline"], "expiresAt": p["expiresAt"], "needsSecond": pol["needsSecond"]})
    store.put("pending", pending)
    store.log("approval requested", {"findingId": findingId, "nonce": p["nonce"]})
    events.publish("approval-request", {"findingId": findingId, "action": action, "headline": f["headline"], "body": body})
    return {"policy": pol, "body": body, "action": action, "stateHash": _state_hash(f)}


@app.get("/api/approvals/pending")
def approvals_pending():
    now = time.time() * 1000
    return {"pending": [p for p in store.get("pending", []) if p["expiresAt"] > now and trust.decode(p["body"] + ".x")["nonce"] not in store.used_nonces()]}


@app.post("/api/approvals/consume")
def approval_consume(token: str | None = Body(None, embed=True), findingId: str = Body(..., embed=True), code: str | None = Body(None, embed=True)):
    """Accepts the full signed token, or the 8-character code for a pending request."""
    key = trust.pairing_key(pairing_code())
    if not token and code:
        for p in store.get("pending", []):
            t = trust.sign(key, p["body"])
            if p["findingId"] == findingId and trust.short_code(t) == code.strip().upper():
                token = t
                break
    if not token:
        raise HTTPException(400, "That code does not match a pending request for this case.")
    f = _finding(findingId)
    v = trust.verify(key, token, store.used_nonces(), findingId, _state_hash(f))
    if not v["ok"]:
        store.log("approval rejected", {"findingId": findingId, "reason": v["reason"]})
        raise HTTPException(403, v["reason"])
    store.use_nonce(v["payload"]["nonce"])
    entry_id = f"A-{len(store.ledger()) + 1:03d}"
    tp = f["explanation"]["topPath"]
    entry = {"id": entry_id, "findingId": findingId, "action": v["payload"]["action"], "line": tp, "status": "approved",
             "approvedBy": v["payload"]["deviceId"], "nonce": v["payload"]["nonce"], "createdAt": int(time.time() * 1000),
             "estimatedMonthlySaving": round(max(0.0, tp["add"]) * 30 * 0.88, 2), "events": []}
    store.save_entry(entry)
    store.log("approval consumed", {"findingId": findingId, "actionId": entry_id, "by": entry["approvedBy"], "nonce": entry["nonce"]})
    events.publish("ledger", {"id": entry_id, "status": "approved", "findingId": findingId, "by": entry["approvedBy"], "nonce": entry["nonce"]})
    return {"ok": True, "actionId": entry_id}


# ---------------------------------------------------------------- execution (local cloud)

@app.post("/api/actions/{action_id}/run")
def run_action(action_id: str, failAt: int | None = Body(None, embed=True)):
    entry = next((e for e in store.ledger() if e["id"] == action_id), None)
    if not entry:
        raise HTTPException(404, "Unknown action")
    if entry["status"] not in ("approved",):
        raise HTTPException(409, f"Action is {entry['status']}; it needs a fresh approval")
    entry["status"] = "running"
    store.save_entry(entry)
    store.log("execute started", {"actionId": action_id, "target": cloud.ENDPOINT or "aws", "simulateFailureAt": failAt})

    def emit(step, label, status, detail):
        ev = {"actionId": action_id, "step": step, "label": label, "status": status, "detail": detail, "at": int(time.time() * 1000)}
        entry["events"].append(ev)
        store.save_entry(entry)
        store.log("execute step", {"actionId": action_id, "step": step + 1, "label": label, "status": status})
        events.publish("execute", ev)

    def work():
        res = cloud.run_park(action_id, entry["line"]["environment"], entry["line"]["application"], failAt, emit)
        entry["status"] = "applied" if res["outcome"] == "done" else "rolled-back"
        entry["result"] = res
        entry["appliedOn"] = max((r.day for r in rows()), default=None) if res["outcome"] == "done" else None
        store.save_entry(entry)
        store.log("execute finished" if res["outcome"] == "done" else "rollback", {"actionId": action_id, "outcome": res["outcome"], "instances": res.get("instances")})
        events.publish("ledger", {"id": action_id, "status": entry["status"], "findingId": entry["findingId"]})

    threading.Thread(target=work, daemon=True).start()
    return {"ok": True, "actionId": action_id, "steps": cloud.STEPS}


@app.get("/api/ledger")
def get_ledger():
    return {"ledger": store.ledger()}


@app.get("/api/cloud/instances")
def get_instances():
    return {"endpoint": cloud.ENDPOINT or "aws", "instances": cloud.instances()}


@app.post("/api/cloud/unpark")
def unpark(request: Request, environment: str = Body(..., embed=True), application: str = Body(..., embed=True)):
    laptop_only(request)
    ids = cloud.unpark(environment, application)
    store.log("instances started", {"environment": environment, "application": application, "instances": ids})
    return {"started": ids}


# ---------------------------------------------------------------- audit

@app.get("/api/audit")
def get_audit(limit: int = 50):
    chain = store.audit_chain()
    return {"n": len(chain), "head": chain[-1]["hash"] if chain else trust.GENESIS, "entries": chain[-limit:]}


@app.get("/api/audit/verify")
def verify_audit():
    return trust.verify_chain(store.audit_chain())


# ---------------------------------------------------------------- labels + learned model

@app.post("/api/labels")
def add_label(findingId: str = Body(..., embed=True), label: str = Body(..., embed=True)):
    f = _finding(findingId)
    store.save_label(findingId, {"features": f["verdict"]["features"], "label": label, "predicted": f["verdict"]["kind"]})
    store.log("verdict labelled", {"findingId": findingId, "label": label})
    return {"labels": len(store.labels()), "minLabels": MIN_LABELS}


@app.post("/api/model/train")
def train_model(force: bool = Body(False, embed=True)):
    labels = store.labels()
    if len(labels) < MIN_LABELS and not force:
        raise HTTPException(409, f"Need {MIN_LABELS} labels to train; have {len(labels)}. The rule-based model stays in charge.")
    prev = store.get("model") or {}
    m = trust.sign_model(train([(x["features"], x["label"]) for x in labels], version=prev.get("version", 0) + 1), trust.pairing_key(pairing_code()))
    store.put("model", m)
    store.put("model_active", len(labels) >= MIN_LABELS)
    store.log("model trained", {"version": m["version"], "trainedOn": m["trainedOn"], "active": len(labels) >= MIN_LABELS})
    return {"version": m["version"], "trainedOn": m["trainedOn"], "active": len(labels) >= MIN_LABELS}


@app.get("/api/model")
def get_model():
    """Signed model JSON; the phone pulls it and verifies the signature before use."""
    return store.get("model") or {"kind": "rules", "note": "No learned model yet: rule-based scoring is in use."}


# ---------------------------------------------------------------- edge node

@app.post("/api/edge/heartbeat")
def heartbeat(hb: dict = Body(...), request: Request = None):
    was = store.get("edge", {})
    online_before = bool(was) and time.time() - was.get("at", 0) < EDGE_TIMEOUT
    edge = {**hb, "at": time.time(), "online": True, "ip": request.client.host if request and request.client else None}
    store.put("edge", edge)
    if not online_before:
        store.log("edge online", {"deviceId": hb.get("deviceId"), "ip": edge["ip"]})
    events.publish("edge", {**edge, "online": True})
    return {"ok": True, "pendingApprovals": len(approvals_pending()["pending"]), "modelVersion": (store.get("model") or {}).get("version")}


@app.post("/api/edge/snapshot")
def snapshot(blob: dict = Body(...)):
    """Encrypted ledger/audit snapshot pushed by the phone (laptop cannot read it without the phone key)."""
    store.put("edge_snapshot", {**blob, "receivedAt": int(time.time() * 1000)})
    store.log("edge snapshot received", {"bytes": len(str(blob.get("ciphertext", ""))), "deviceId": blob.get("deviceId")})
    return {"ok": True}


@app.post("/api/reset")
def reset(request: Request):
    """Fresh demo: clear SQLite, start every parked instance, reload the sample export from the bucket."""
    laptop_only(request)
    code = pairing_code()
    store.reset()
    store.put("pairing_code", code)
    ec2 = cloud.client("ec2")
    stopped = [i["id"] for i in cloud.instances() if i["state"] in ("stopped", "stopping")]
    if stopped:
        ec2.start_instances(InstanceIds=stopped)
    key = "cur/2024-09/walkthrough_daily_by_service_region_tag.csv"
    cloud.deliver(key, read_bytes(DATA / "walkthrough_daily_by_service_region_tag.csv"))
    load_rows(parse_csv(cloud.fetch(key).decode("utf-8-sig")).rows, {"source": "s3", "key": key, "name": "FOCUS 1.0 public sample"})
    return {"ok": True, "restarted": stopped}


# ---------------------------------------------------------------- phone bundle (Termux)

@app.get("/api/dataset.csv")
def dataset_csv():
    from fastapi.responses import Response
    return Response(to_csv(rows()), media_type="text/csv")


@app.get("/api/edge/bundle")
def edge_bundle():
    """engine/ + narrator + edge_node as a tar.gz: the phone runs the same code as the laptop."""
    import tarfile
    from fastapi.responses import Response
    from paths import ROOT
    buf = io.BytesIO()
    base = ROOT / "server"
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in ["engine/__init__.py", "engine/core.py", "engine/trust.py", "engine/model.py", "narrator.py", "edge_node.py"]:
            data = read_bytes(base / rel)
            info = tarfile.TarInfo("spendsentinel-edge/" + rel)
            info.size = len(data)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
        # The built web app (npm run build): the phone serves it on localhost, which browsers
        # treat as a secure page, so it installs as an offline app (service worker) there.
        import os
        from paths import long
        dist = long(ROOT / "dist")
        for dirpath, _dirs, files in os.walk(dist):
            for name in files:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, dist).replace("\\", "/")
                with open(full, "rb") as f:
                    data = f.read()
                info = tarfile.TarInfo("spendsentinel-edge/web/" + rel)
                info.size = len(data)
                info.mtime = int(time.time())
                tar.addfile(info, io.BytesIO(data))
    return Response(buf.getvalue(), media_type="application/gzip")


@app.get("/api/edge/setup.sh")
def edge_setup(request: Request):
    """Usage on the phone (Termux):  curl -fsS http://<laptop>:5173/api/edge/setup.sh | bash -s <PAIRING-CODE>
    Works through the web app's port (5173, the path the phone browser already uses) or the API port (8787):
    the script talks back to whichever address it was downloaded from."""
    from fastapi.responses import PlainTextResponse
    host = request.headers.get("host", "127.0.0.1:8787")
    laptop = f"http://{host}"
    return PlainTextResponse(f"""#!/data/data/com.termux/files/usr/bin/bash
# SpendSentinel edge node setup for Termux. Laptop: {laptop}
CODE="$1"
fail() {{ echo; echo "!! $1"; echo "   Nothing was started. Fix the above and run the same command again."; exit 1; }}
[ -n "$CODE" ] || fail "Add the pairing code at the end:  ... | bash -s ABCD2345"
echo "== 1/5 laptop link: {laptop}"
curl -fsS -m 8 {laptop}/api/health >/dev/null || fail "Cannot reach the laptop at {laptop}. Is USB tethering on and the laptop app running?"
echo "   ok"
echo "== 2/5 python (first time downloads ~50 MB, shows progress)"
if ! command -v python >/dev/null; then pkg install -y python || fail "pkg install python failed. Run 'termux-change-repo', pick a mirror, try again."; fi
python -c "import cryptography" 2>/dev/null || pkg install -y python-cryptography || echo "   (no python-cryptography: snapshots are signed but not encrypted)"
python --version
echo "== 3/5 app + edge code from the laptop"
cd ~ && rm -rf spendsentinel-edge && curl -fsS -m 120 {laptop}/api/edge/bundle -o ss-edge.tgz && tar xzf ss-edge.tgz && rm ss-edge.tgz || fail "Download from the laptop failed."
[ -f ~/spendsentinel-edge/web/index.html ] || fail "The bundle has no web app. On the laptop run: npm run build"
echo "   ok ($(ls ~/spendsentinel-edge/web | wc -l) web files)"
cat > ~/spendsentinel-edge/run.sh <<EOF
cd ~/spendsentinel-edge && exec python edge_node.py --laptop {laptop} --code $CODE
EOF
chmod +x ~/spendsentinel-edge/run.sh
command -v termux-wake-lock >/dev/null && termux-wake-lock || true
echo "== 4/5 pairing code $CODE"
echo "== 5/5 starting the edge node (keep Termux open; Ctrl+C stops; restart: ~/spendsentinel-edge/run.sh)"
echo "   Then open in Chrome on this phone:  http://localhost:8080/#/m"
exec ~/spendsentinel-edge/run.sh
""")


# ---------------------------------------------------------------- device diagnostics

@app.post("/api/client-log")
def client_log(entry: dict = Body(...), request: Request = None):
    """What a phone page reports (hold events, errors). Kept in memory-sized ring, printed to the console."""
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    e = {**{k: entry.get(k) for k in ("msg", "data", "page", "ua", "at")}, "ip": ip}
    logs = (store.get("client_log", []) + [e])[-200:]
    store.put("client_log", logs)
    print(f"[device {ip}] {e['msg']} {json.dumps(e.get('data'))[:200]} page={e.get('page')}", flush=True)
    return {"ok": True}


@app.get("/api/client-log")
def get_client_log(request: Request):
    laptop_only(request)
    return {"entries": store.get("client_log", [])[-50:]}

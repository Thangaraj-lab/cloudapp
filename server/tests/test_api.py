"""End to end through the API: S3 delivery → findings → phone-signed approval → executor on the
local cloud (moto EC2) → rollback on failure / stopped instance on success → audit chain verifies."""
import os
import tempfile
import time

os.environ["SPENDSENTINEL_HOME"] = tempfile.mkdtemp(prefix="ss-test-")
os.environ["SPENDSENTINEL_CLOUD_PORT"] = "5077"
os.environ["SPENDSENTINEL_LLM_TIMEOUT"] = "0.5"

from fastapi.testclient import TestClient  # noqa: E402

import app as api  # noqa: E402
from engine import trust  # noqa: E402


def _wait(c, action_id, until=("applied", "rolled-back"), t=20):
    end = time.time() + t
    while time.time() < end:
        e = next(x for x in c.get("/api/ledger").json()["ledger"] if x["id"] == action_id)
        if e["status"] in until:
            return e
        time.sleep(0.2)
    raise AssertionError("action did not finish")


def _approve(c, fid):
    req = c.post("/api/approvals/request", json={"findingId": fid}).json()
    assert req["policy"]["result"] == "needs-approval"
    code = "TESTCODE"
    c.post("/api/pairing", json={"code": code, "rotate": True})
    token = trust.sign(trust.pairing_key(code), req["body"])  # what the phone does after hold-to-approve
    r = c.post("/api/approvals/consume", json={"findingId": fid, "code": trust.short_code(token)})
    assert r.status_code == 200, r.text
    # the same token cannot be used twice
    assert c.post("/api/approvals/consume", json={"findingId": fid, "token": token}).status_code == 403
    return r.json()["actionId"]


def test_full_flow():
    with TestClient(api.app) as c:
        h = c.get("/api/health").json()
        assert h["cloud"]["ok"] and h["dataset"]["source"] == "s3"
        a = c.get("/api/analysis").json()
        assert [f["finding"]["day"] for f in a["findings"]] == ["2024-09-09", "2024-09-12", "2024-09-18"]
        assert abs(a["total"] - 1430.99) < 0.01
        assert c.get("/api/cloud/exports").json()["exports"][0]["key"].startswith("cur/")

        fid = "f-2024-09-18"
        tp = next(f for f in a["findings"] if f["finding"]["id"] == fid)["explanation"]["topPath"]
        target = [i for i in c.get("/api/cloud/instances").json()["instances"] if i.get("environment") == tp["environment"] and i.get("application") == tp["application"]]
        assert target and target[0]["state"] == "running"

        # failure at step 4 → reverse rollback, instance still running, no saving
        aid = _approve(c, fid)
        c.post(f"/api/actions/{aid}/run", json={"failAt": 4})
        e = _wait(c, aid)
        assert e["status"] == "rolled-back" and any(x["status"] == "rolled-back" for x in e["events"])
        assert next(i for i in c.get("/api/cloud/instances").json()["instances"] if i["id"] == target[0]["id"])["state"] == "running"
        # a rolled-back action cannot run again without a new approval
        assert c.post(f"/api/actions/{aid}/run", json={}).status_code == 409

        # success → instance stopped in the local cloud
        aid2 = _approve(c, fid)
        c.post(f"/api/actions/{aid2}/run", json={})
        e2 = _wait(c, aid2)
        assert e2["status"] == "applied" and e2["appliedOn"] == "2024-09-30"
        assert next(i for i in c.get("/api/cloud/instances").json()["instances"] if i["id"] == target[0]["id"])["state"] == "stopped"

        # narrator falls back to the template when the model is slow/unavailable or adds numbers
        n = c.post("/api/narrate", json={"findingId": "f-2024-09-09"}).json()
        assert n["text"] and n["source"] in ("llm", "template")

        # edge heartbeat and audit chain
        assert c.post("/api/edge/heartbeat", json={"deviceId": "phone-test"}).json()["ok"]
        assert c.get("/api/health").json()["edge"]["online"]
        assert c.get("/api/audit/verify").json()["ok"]


def test_policy_denies_prod_and_upload_roundtrip():
    with TestClient(api.app) as c:
        rows = [{"day": f"2024-01-{d:02d}", "service": "Amazon Elastic Compute Cloud", "environment": "prod", "application": "shop", "cost": 10 if d < 12 else 40} for d in range(1, 15)]
        r = c.post("/api/datasets/rows", json={"name": "prod.csv", "rows": rows}).json()
        assert r["findings"] == 1 and r["key"].startswith("uploads/")
        fid = c.get("/api/analysis").json()["findings"][0]["finding"]["id"]
        assert c.post("/api/approvals/request", json={"findingId": fid}).json()["policy"]["result"] == "deny"


def test_narrator_guardrail():
    import narrator
    facts = {"extra_per_day_usd": "11.70", "day": "2024-09-09"}
    assert narrator.check("EC2 in dev added $11.70 a day since 2024-09-09.", facts)
    assert not narrator.check("EC2 in dev added $15.00 a day.", facts)

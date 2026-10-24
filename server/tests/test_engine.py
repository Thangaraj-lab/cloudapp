"""Golden tests: the Python engine must reproduce the reference results (same as the TS engine)."""
import json
import time

from engine.core import analyze, daily_totals, detect, explain, parse_csv
from engine import trust
from engine.model import TreeModel, train

from paths import DATA, read_text

ROWS = parse_csv(read_text(DATA / "walkthrough_daily_by_service_region_tag.csv")).rows
REF = json.loads(read_text(DATA / "walkthrough_findings.json"))


def test_total():
    assert abs(sum(r.cost for r in ROWS) - 1430.99) < 0.01


def test_detect_reproduces_reference():
    found = detect(daily_totals(ROWS))
    assert [f.day for f in found] == [x["day"] for x in REF["flags"]]
    for f, ref in zip(found, REF["flags"]):
        assert abs(f.cost - ref["cost"]) < 0.1
        assert abs(f.baseline_median - ref["trailing7_median"]) < 0.1
        assert abs(f.z - ref["robust_z"]) < 0.1


def test_explain_sep9():
    f = detect(daily_totals(ROWS))[0]
    ex = explain(ROWS, f)
    assert ex.by_service[0].name == "Amazon Elastic Compute Cloud"
    assert ex.by_environment[0].name == "dev"
    assert abs(ex.total_delta - 11.51) < 0.1


def test_verdicts():
    a = analyze(ROWS)
    assert [x["finding"]["day"] for x in a["findings"]] == ["2024-09-09", "2024-09-12", "2024-09-18"]
    assert a["findings"][0]["verdict"]["kind"] == "Waste"
    assert a["findings"][0]["headline"].startswith("EC2 in dev added $")


def test_parse_quarantine_and_duplicates():
    bad = "day,service,region,environment,application,billed_cost_usd\n2024-09-01,EC2,us,dev,a,1\n2024-09-01,EC2,us,dev,a,1\nnotadate,EC2,us,dev,a,1\n2024-09-02,EC2,us,dev,a,abc\n2024-09-03,,us,dev,a,1\n"
    r = parse_csv(bad)
    assert len(r.rows) == 1 and r.duplicates == 1
    assert [q["reason"] for q in r.quarantine] == ["Unparseable date", "Cost is not numeric", "Service is empty"]


def test_audit_chain_and_tamper():
    chain = []
    for i in range(5):
        trust.append(chain, "t", f"e{i}", {"i": i}, ts=1000 + i)
    assert trust.verify_chain(chain)["ok"]
    chain[2] = {**chain[2], "payload": {"i": 99}}
    assert trust.verify_chain(chain) == {"ok": False, "brokenAt": 2}


def test_approval_tokens():
    key = trust.pairing_key("ABCD2345")
    body = trust.request("f-1", "park", "abc", "phone")
    tok = trust.sign(key, body)
    assert trust.verify(key, tok, set(), "f-1", "abc")["ok"]
    nonce = trust.decode(tok)["nonce"]
    assert not trust.verify(key, tok, {nonce}, "f-1", "abc")["ok"]                     # replay
    assert not trust.verify(key, tok, set(), "f-1", "zzz")["ok"]                      # stale state
    assert not trust.verify(key, "x" + tok, set(), "f-1", "abc")["ok"]                # tampered
    assert not trust.verify(key, tok, set(), "f-1", "abc", now_ms=int(time.time() * 1000) + trust.TTL_MS + 1)["ok"]  # expired
    assert trust.short_code(tok) == tok.split(".")[1][:8].upper()


def test_policy():
    p = trust.DEFAULT_POLICY
    assert trust.evaluate(p, "prod", 1, True)["result"] == "deny"
    assert trust.evaluate(p, "dev", 80, True)["needsSecond"]


def test_model_training_and_signing():
    samples = [({"devShare": 1, "sustained": 0.2}, "Waste")] * 6 + [({"networkShare": 0.9, "sustained": 0.1}, "Misconfig")] * 6 + [({"prodShare": 1, "sustained": 1}, "Growth")] * 6
    m = train(samples)
    assert TreeModel(m).scores({"devShare": 1, "sustained": 0.2})["Waste"] == 1.0
    key = trust.pairing_key("ABCD2345")
    signed = trust.sign_model(m, key)
    assert trust.verify_model(signed, key)
    signed["tree"] = {"leaf": {"Waste": 1, "Misconfig": 0, "Growth": 0}, "n": 1}
    assert not trust.verify_model(signed, key)

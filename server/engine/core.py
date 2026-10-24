"""Detection, explanation and verdict. Pure Python (stdlib only), the same rules as
src/engine/*.ts so the laptop API, the phone edge node and the browser agree.
Runs on Python >= 3.10 (Termux ships 3.11+)."""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import median

# ---------------------------------------------------------------- parse

REQUIRED = ["day", "service", "region", "environment", "application", "billed_cost_usd"]


@dataclass
class Row:
    day: str
    service: str
    region: str
    environment: str
    application: str
    cost: float


@dataclass
class ParseResult:
    rows: list[Row]
    quarantine: list[dict]
    missing_columns: list[str]
    duplicates: int = 0


DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_csv(text: str) -> ParseResult:
    """The canonical daily CSV (day, service, region, environment, application, billed_cost_usd)."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿").strip()))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    reader.fieldnames = fields
    missing = [c for c in REQUIRED if c not in fields]
    if missing:
        return ParseResult([], [], missing)
    rows, quarantine, seen, dups = [], [], set(), 0
    for i, r in enumerate(reader):
        line = i + 2
        raw = ",".join((v or "") for v in r.values())
        d = (r.get("day") or "").strip()
        c = (r.get("billed_cost_usd") or "").strip()
        s = (r.get("service") or "").strip()
        try:
            ok_day = bool(DAY_RE.match(d)) and date.fromisoformat(d) is not None
        except ValueError:
            ok_day = False
        try:
            cost = float(c) if c != "" else None
        except ValueError:
            cost = None
        if not ok_day:
            quarantine.append({"line": line, "reason": "Unparseable date", "raw": raw})
        elif cost is None or cost != cost or cost in (float("inf"), float("-inf")):
            quarantine.append({"line": line, "reason": "Cost is not numeric", "raw": raw})
        elif not s:
            quarantine.append({"line": line, "reason": "Service is empty", "raw": raw})
        elif raw in seen:
            dups += 1
        else:
            seen.add(raw)
            rows.append(Row(d, s, (r.get("region") or "").strip() or "untagged", (r.get("environment") or "").strip() or "untagged",
                            (r.get("application") or "").strip() or "untagged", cost))
    return ParseResult(rows, quarantine, [], dups)


# ---------------------------------------------------------------- series

def add_days(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def date_range(rows: list[Row]) -> list[str]:
    if not rows:
        return []
    days = sorted(r.day for r in rows)
    out, d = [], days[0]
    while d <= days[-1]:
        out.append(d)
        d = add_days(d, 1)
    return out


def daily_totals(rows: list[Row]) -> list[tuple[str, float]]:
    m: dict[str, float] = {}
    for r in rows:
        m[r.day] = m.get(r.day, 0.0) + r.cost
    return [(d, m.get(d, 0.0)) for d in date_range(rows)]


def med(xs: list[float]) -> float:
    return median(xs) if xs else 0.0


def days_in_month(d: str) -> int:
    y, m, _ = (int(x) for x in d.split("-"))
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - timedelta(days=1)).day


# ---------------------------------------------------------------- detect

@dataclass
class Params:
    window: int = 7
    z_threshold: float = 3.5
    min_change: float = 5.0


MAD_FLOOR = 0.01


@dataclass
class Point:
    day: str
    cost: float
    median: float | None = None
    mad: float | None = None
    z: float | None = None


def baseline(series: list[tuple[str, float]], p: Params = Params()) -> list[Point]:
    out = []
    for i, (d, c) in enumerate(series):
        if i < p.window:
            out.append(Point(d, c))
            continue
        win = [x for _, x in series[i - p.window:i]]
        m = med(win)
        mad = max(med([abs(x - m) for x in win]), MAD_FLOOR)
        out.append(Point(d, c, m, mad, 0.6745 * (c - m) / mad))
    return out


@dataclass
class Finding:
    id: str
    day: str
    cost: float
    baseline_median: float
    mad: float
    z: float
    delta_per_day: float
    severity: str
    remaining_days: int
    money_at_risk: float
    injected: str | None = None


def severity(z: float) -> str:
    return "high" if abs(z) >= 6 else "medium" if abs(z) >= 4.5 else "low"


def detect(series: list[tuple[str, float]], p: Params = Params()) -> list[Finding]:
    """Upward anomalies; consecutive flagged days are one episode reported on its first day."""
    out, prev = [], False
    for pt in baseline(series, p):
        flagged = pt.z is not None and pt.z > p.z_threshold and pt.cost - (pt.median or 0) >= p.min_change
        if flagged and not prev:
            delta = pt.cost - pt.median
            remaining = days_in_month(pt.day) - int(pt.day[8:]) + 1
            out.append(Finding("f-" + pt.day, pt.day, pt.cost, pt.median, pt.mad, pt.z, delta, severity(pt.z), remaining, delta * remaining))
        prev = flagged
    return out


# ---------------------------------------------------------------- explain

@dataclass
class Node:
    name: str
    delta: float
    share: float
    children: list["Node"] = field(default_factory=list)


def _deltas(rows: list[Row], f: Finding, window: int, key) -> dict[str, float]:
    start = add_days(f.day, -window)
    m: dict[str, float] = {}
    for r in rows:
        k = key(r)
        if r.day == f.day:
            m[k] = m.get(k, 0.0) + r.cost
        elif start <= r.day < f.day:
            m[k] = m.get(k, 0.0) - r.cost / window
    return m


def _nodes(m: dict[str, float], total: float) -> list[Node]:
    ns = [Node(k, v, v / total if total else 0.0) for k, v in m.items() if abs(v) > 1e-6]
    return sorted(ns, key=lambda n: -n.delta)


@dataclass
class Explanation:
    total_delta: float
    by_service: list[Node]
    by_environment: list[Node]
    by_application: list[Node]
    by_region: list[Node]
    tree: list[Node]
    top_path: dict


def short_service(s: str) -> str:
    return s.replace("Amazon Elastic Compute Cloud", "EC2").replace("Amazon ", "").replace("AWS ", "")


def explain(rows: list[Row], f: Finding, window: int = 7) -> Explanation:
    svc = _deltas(rows, f, window, lambda r: r.service)
    total = sum(svc.values())
    by_service = _nodes(svc, total)
    full = _deltas(rows, f, window, lambda r: (r.service, r.environment, r.application))
    tree = []
    for s in by_service:
        envs: dict[str, dict[str, float]] = {}
        for (sv, env, app), d in full.items():
            if sv == s.name:
                envs.setdefault(env, {})[app] = d
        children = [Node(env, sum(apps.values()), (sum(apps.values()) / total) if total else 0.0, _nodes(apps, total)) for env, apps in envs.items()]
        tree.append(Node(s.name, s.delta, s.share, sorted([c for c in children if abs(c.delta) > 1e-6], key=lambda n: -n.delta)))
    top_s = tree[0] if tree else None
    top_e = top_s.children[0] if top_s and top_s.children else None
    top_a = top_e.children[0] if top_e and top_e.children else None
    top_path = {"service": top_s.name if top_s else "unknown", "environment": top_e.name if top_e else "untagged",
                "application": top_a.name if top_a else "untagged", "add": top_a.delta if top_a else total, "share": top_a.share if top_a else 1.0}
    return Explanation(total, by_service, _nodes(_deltas(rows, f, window, lambda r: r.environment), total),
                       _nodes(_deltas(rows, f, window, lambda r: r.application), total),
                       _nodes(_deltas(rows, f, window, lambda r: r.region), total), tree, top_path)


# ---------------------------------------------------------------- verdict

NETWORK = re.compile(r"NAT|Data Transfer|DataTransfer|CloudWatch|VPC|Load Balanc|Request", re.I)
clamp = lambda x: max(0.0, min(1.0, x))  # noqa: E731


def _share(nodes: list[Node], total: float, pred) -> float:
    if total <= 0:
        return 0.0
    return clamp(sum(n.delta for n in nodes if pred(n.name)) / total)


def sustained_score(series: list[tuple[str, float]], f: Finding, days: int = 3) -> float:
    idx = next((i for i, (d, _) in enumerate(series) if d == f.day), -1)
    after = series[idx + 1: idx + 1 + days]
    if not after or f.delta_per_day <= 0:
        return 0.5
    return clamp(min(c - f.baseline_median for _, c in after) / f.delta_per_day)


@dataclass
class Verdict:
    kind: str
    scores: dict[str, float]
    confidence: str
    margin: float
    features: dict[str, float]
    reasons: list[str]
    would_change: str
    model: str = "rule-based scoring model"


def features_for(f: Finding, ex: Explanation, series: list[tuple[str, float]], idle_signal: float = 0.0) -> dict[str, float]:
    t = ex.total_delta
    return {
        "devShare": _share(ex.by_environment, t, lambda n: bool(re.match(r"^(dev|test|staging|untagged)$", n, re.I))),
        "prodShare": _share(ex.by_environment, t, lambda n: bool(re.match(r"^prod", n, re.I))),
        "untaggedShare": _share(ex.by_environment, t, lambda n: n == "untagged"),
        "networkShare": _share(ex.by_service, t, lambda n: bool(NETWORK.search(n))),
        "sustained": sustained_score(series, f),
        "idleSignal": idle_signal,
    }


def rule_scores(x: dict[str, float]) -> dict[str, float]:
    return {
        "Waste": 0.5 * x["devShare"] + 0.3 * (1 - x["sustained"]) + 0.2 * x["idleSignal"],
        "Misconfig": 0.6 * x["networkShare"] + 0.25 * (1 - x["sustained"]) + 0.15 * x["untaggedShare"],
        "Growth": 0.6 * x["prodShare"] + 0.4 * x["sustained"],
    }


def pct(x: float) -> str:
    return f"{round(x * 100)}%"


def judge(f: Finding, ex: Explanation, series, idle_signal: float = 0.0, model=None) -> Verdict:
    x = features_for(f, ex, series, idle_signal)
    scores = model.scores(x) if model else rule_scores(x)
    ranked = sorted(scores, key=lambda k: -scores[k])
    kind, margin = ranked[0], scores[ranked[0]] - scores[ranked[1]]
    conf = "High" if margin > 0.35 else "Medium" if margin > 0.15 else "Low"
    reasons: list[str] = []
    if kind == "Waste":
        reasons.append(f"{pct(x['devShare'])} of the jump is in dev/test/untagged resources")
        reasons.append("The new cost level did not persist like real demand would" if x["sustained"] < 0.5
                       else f"Cost stayed up ({pct(x['sustained'])} of the jump persisted) with no production share")
        if x["idleSignal"]:
            reasons.append("A matching idle resource is running (CPU under 5%)")
    elif kind == "Misconfig":
        reasons.append(f"{pct(x['networkShare'])} of the jump is network / data-processing lines")
        if x["untaggedShare"] > 0.2:
            reasons.append(f"{pct(x['untaggedShare'])} is untagged (no owner)")
        reasons.append("One-day burst, not a steady new level" if x["sustained"] < 0.5 else "Elevated level persisted")
    else:
        reasons.append(f"{pct(x['prodShare'])} of the jump is in production-tagged resources")
        reasons.append(f"The new level persisted ({pct(x['sustained'])} of the jump held for 3 days)")
    would = {
        "Waste": "If this cost moved to production tags and held steady for 3+ days, it would read as Growth.",
        "Misconfig": "If the jump were in compute rather than network lines, or tagged to an owner, it would read as Waste or Growth.",
        "Growth": "If the jump were in dev/test or faded within a day or two, it would read as Waste.",
    }[kind]
    return Verdict(kind, scores, conf, margin, x, reasons, would, model.name if model else "rule-based scoring model")


# ---------------------------------------------------------------- analyze

def headline(f: Finding, ex: Explanation, v: Verdict) -> str:
    tp = ex.top_path
    where = f" in {tp['environment']}" if tp["environment"] != "untagged" else " (untagged)"
    d = date.fromisoformat(f.day)
    when = f"{d.strftime('%b')} {d.day}"
    guess = ("Looks like a forgotten test environment." if v.kind == "Waste" and re.match(r"^(dev|test|staging|qa)$", tp["environment"], re.I)
             else {"Waste": "Looks like something left running.", "Misconfig": "Looks like a setting or routing problem.",
                   "Growth": "Looks like real demand growing."}[v.kind])
    return f"{short_service(tp['service'])}{where} added ${max(0.0, tp['add']):.2f} a day since {when}. {guess}"


def node_json(n: Node) -> dict:
    return {"name": n.name, "delta": round(n.delta, 6), "share": round(n.share, 6), "children": [node_json(c) for c in n.children]}


def analyze(rows: list[Row], p: Params = Params(), model=None) -> dict:
    series = daily_totals(rows)
    out = []
    for f in detect(series, p):
        ex = explain(rows, f, p.window)
        v = judge(f, ex, series, 0.0, model)
        out.append({
            "finding": {"id": f.id, "day": f.day, "cost": f.cost, "baselineMedian": f.baseline_median, "mad": f.mad, "z": f.z,
                        "deltaPerDay": f.delta_per_day, "severity": f.severity, "remainingDays": f.remaining_days, "moneyAtRisk": f.money_at_risk},
            "explanation": {"totalDelta": ex.total_delta, "topPath": ex.top_path,
                            "byService": [node_json(n) for n in ex.by_service[:8]], "byEnvironment": [node_json(n) for n in ex.by_environment],
                            "tree": [node_json(n) for n in ex.tree[:5]]},
            "verdict": {"kind": v.kind, "scores": v.scores, "confidence": v.confidence, "margin": v.margin, "features": v.features,
                        "reasons": v.reasons, "wouldChange": v.would_change, "model": v.model},
            "headline": headline(f, ex, v),
        })
    return {"series": [{"day": d, "cost": c} for d, c in series], "findings": out, "total": sum(r.cost for r in rows),
            "services": len({r.service for r in rows}), "days": len(series)}

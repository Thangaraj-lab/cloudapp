"""SQLite persistence: dataset, audit chain, ledger, nonces, labels, edge state.
Small JSON documents; the engine works on in-memory rows."""
from __future__ import annotations

import json
import sqlite3
import threading
import time

from engine import trust
from paths import HOME

_lock = threading.RLock()
_db = sqlite3.connect(HOME / "spendsentinel.db", check_same_thread=False)
_db.executescript("""
create table if not exists kv (k text primary key, v text not null);
create table if not exists audit (i integer primary key, doc text not null);
create table if not exists ledger (id text primary key, doc text not null);
create table if not exists nonces (nonce text primary key, ts integer);
create table if not exists labels (finding_id text primary key, doc text not null);
""")
_db.commit()


def get(k: str, default=None):
    with _lock:
        r = _db.execute("select v from kv where k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default


def put(k: str, v) -> None:
    with _lock:
        _db.execute("insert or replace into kv values (?, ?)", (k, json.dumps(v)))
        _db.commit()


# ---------------------------------------------------------------- audit

def audit_chain() -> list[dict]:
    with _lock:
        return [json.loads(r[0]) for r in _db.execute("select doc from audit order by i")]


def log(event: str, payload=None, actor: str = "api@laptop") -> dict:
    with _lock:
        chain = audit_chain()
        e = trust.append(chain, actor, event, payload or {})
        _db.execute("insert into audit values (?, ?)", (e["i"], json.dumps(e)))
        _db.commit()
    from events import publish  # late import: events needs the running loop
    publish("audit", {"i": e["i"], "event": event, "hash": e["hash"]})
    return e


# ---------------------------------------------------------------- nonces / ledger / labels

def used_nonces() -> set[str]:
    with _lock:
        return {r[0] for r in _db.execute("select nonce from nonces")}


def use_nonce(n: str) -> None:
    with _lock:
        _db.execute("insert or ignore into nonces values (?, ?)", (n, int(time.time())))
        _db.commit()


def ledger() -> list[dict]:
    with _lock:
        return [json.loads(r[0]) for r in _db.execute("select doc from ledger order by id")]


def save_entry(e: dict) -> None:
    with _lock:
        _db.execute("insert or replace into ledger values (?, ?)", (e["id"], json.dumps(e)))
        _db.commit()


def labels() -> list[dict]:
    with _lock:
        return [json.loads(r[0]) for r in _db.execute("select doc from labels")]


def save_label(finding_id: str, doc: dict) -> None:
    with _lock:
        _db.execute("insert or replace into labels values (?, ?)", (finding_id, json.dumps(doc)))
        _db.commit()


def reset() -> None:
    with _lock:
        for t in ("kv", "audit", "ledger", "nonces", "labels"):
            _db.execute(f"delete from {t}")
        _db.commit()

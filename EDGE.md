# SpendSentinel — local product stack (laptop + phone)

Companion to `CLAUDE.md` (screens, engine rules) and `DECISIONS.md`. This file defines the **real local architecture**: a backend, a local cloud, local AI and a phone edge node, connected over **USB tethering**.

## 1. Topology

```
┌──────────────────────── LAPTOP (Windows, native — no Docker) ────────────────────────┐
│ Web UI (Vite, :5173)  ──/api proxy──►  API + engine (FastAPI, :8787)  ── SQLite       │
│                                        │                                              │
│                                        ├─► LOCAL CLOUD: moto server (:5055)           │
│                                        │     S3 bucket "billing-exports" (CUR delivery)│
│                                        │     EC2 instances tagged env/app              │
│                                        │     boto3 executor: snapshot → stop / start   │
│                                        └─► Ollama (:11434) llama3.2:3b — wording only │
└───────────────▲──────────────────────────────────────────────▲───────────────────────┘
                │ USB tethering (phone = router, no internet)   │ signed model JSON (pull)
┌───────────────┴──────────────── PHONE (Termux) ──────────────┴───────────────────────┐
│ Edge node (Python stdlib + cryptography, :8080): same engine/ code · SQLite ·        │
│ audit chain · signed-model verify · heartbeat → laptop · encrypted snapshot push     │
│ Approver UI = phone browser on http://<laptop-ip>:5173/#/m (hold to approve)          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. One workflow, end to end

1. **Delivery.** A billing export lands in the local S3 bucket (`billing-exports/cur/…`), the way AWS delivers a CUR/FOCUS export. You can also upload a file in the UI; the API stores it in the same bucket.
2. **Ingest.** API pulls the newest object → engine parse/validate (quarantine, duplicates, non-usage) → SQLite. Audit: `dataset loaded`.
3. **Detect → explain → judge.** Engine findings (golden: Sep 9/12/18), verdict scores (rule-based, or the signed learned tree once ≥ 20 labels exist).
4. **Narrate.** Ollama turns engine facts into one sentence. Every number in the output must appear in the facts, otherwise the template sentence is used. Raw rows are never sent to the model.
5. **Plan + policy.** Prod denied; above the cost limit a second approver is required.
6. **Approve on phone.** Laptop creates a request (nonce, 10-min TTL, state hash). The phone signs it (HMAC with the paired key) after a 1-second hold; the laptop verifies and consumes the nonce.
7. **Execute.** API executor runs the saga with **boto3 against the local cloud** (`endpoint_url` = moto): pre-check → snapshot volumes → tag → stop instances → verify state. Any failure → reverse rollback (start instances, delete tags), no saving counted.
8. **Receipt.** Ledger entry + audit block; the phone fetches the receipt.
9. **Verify.** The next export (or the simulated clock) measures before vs after; verified saving only above 3× noise.
10. **Prevent.** Enabled rules run on every new import and raise notifications.
11. **Edge.** The phone pulls the signed verdict model, sends a heartbeat every 5 s and pushes an encrypted snapshot of its ledger/audit. 3 missed heartbeats → laptop marks the edge offline and keeps analysing alone (best-effort standby, not HA).

## 3. Connecting layer (who talks to whom)

| From → to | Transport | Payload | Security |
|---|---|---|---|
| Browser → API | HTTP via Vite proxy `/api` | JSON | same origin; API binds 0.0.0.0 for the phone |
| API → local cloud | boto3 (`endpoint_url=http://127.0.0.1:5055`) | AWS API calls | test credentials only; remove `endpoint_url` + use a scoped role for real AWS |
| API → Ollama | HTTP `/api/generate` | engine facts only | 5 s timeout, number guardrail, template fallback |
| Phone → laptop | HTTP over USB tether | heartbeat, model pull, snapshot push, receipts | phone initiates everything; model JSON signed (HMAC, Ed25519 when `cryptography` is present) |
| Phone ↔ laptop (approval) | QR link / 8-char code / paste | signed token | HMAC-SHA256, nonce, TTL, state hash |

## 4. USB tethering setup (you do this once)

1. Phone: Settings → Hotspot & tethering → **USB tethering ON**. Mobile data may stay off (offline proof).
2. Laptop: a new adapter ("Remote NDIS") appears with an address like `192.168.x.x`. `npm run dev` lists it under *Network:*; the app's `/__lan` finds it too.
3. Windows marks new networks **Public**. Allow Node and Python on it once (admin PowerShell):
   ```powershell
   New-NetFirewallRule -DisplayName "SpendSentinel dev" -Direction Inbound -Protocol TCP -LocalPort 5173,8787 -Action Allow -Profile Any
   ```
4. Phone browser: open the QR from **Phone / Edge** → `http://<laptop-ip>:5173/#/m` → **Test connection**.

## 5. Build stages and acceptance tests

| Stage | What | Accepted when |
|---|---|---|
| 1 | `server/engine/` pure Python (stdlib only, Python ≥ 3.11) | `pytest`: total 1430.99, findings Sep 9/12/18 with z ±0.1, Sep 9 = Waste, audit verify/tamper, approval expired/reused/tampered rejected |
| 2 | FastAPI + SQLite | `GET /api/analysis` returns the 3 findings; upload → same result |
| 3 | Local cloud (moto) + executor | approve → instance `stopped` + snapshot exists → ledger; failure at step N → instance `running` again, no saving |
| 4 | Narrator + model signing | Ollama sentence passes the number check or falls back; tampered model JSON rejected |
| 5 | Web UI on API | top bar shows *Local cloud: connected*; Live run uses the executor; Connect cloud → local bucket works; falls back to browser mode when API is down |
| 6 | Phone edge node | on the phone: `curl localhost:8080/findings` → same 3 findings; heartbeat visible on Phone / Edge; snapshot received |

## 5b. Build status (verified)

| Stage | Status | Evidence |
|---|---|---|
| 1 Engine (Python) | ✅ | `server/tests/test_engine.py`: golden Sep 9/12/18, total 1430.99, verdicts, audit tamper, tokens, policy, model signing |
| 2 API + SQLite | ✅ | `server/app.py`; DB in `%USERPROFILE%\.spendsentinel` (short path) |
| 3 Local cloud | ✅ | `server/tests/test_api.py`: approve → EC2 `stopped`; failure at step 4 → rollback, instance `running`, no saving, re-run refused |
| 4 Narrator + model | ✅ | llama3.2:3b, ~1.6 s warm (CPU: the NVIDIA driver is not visible to Ollama yet); number guardrail; tampered model rejected |
| 5 Web UI on API | ✅ | `scripts/demo.mjs` full path with no page errors: Run on local cloud, phone approval delivered live via the API |
| 6 Edge node | ✅ on laptop, ⏳ on the phone | Bundle + `edge_node.py` tested as a second process: 3 findings computed locally, heartbeat, encrypted snapshot, standby on missed heartbeats. Run it in Termux to finish. |

Security notes: the API never returns the pairing code (only a hash). `/api/pairing`, `/api/reset` and `/api/cloud/unpark` answer only the laptop itself; the Vite proxy forwards the phone's address so it cannot pass as local. Approvals still need a valid HMAC signature, unused nonce, TTL and state hash.

## 6. Honest limits
- moto is a mock: real AWS can behave differently. Test once on a free-tier account before claiming anything.
- The phone is an **edge node prototype**, not a data centre. Android may kill background processes (battery "Unrestricted", `termux-wake-lock`, developer option "Disable child process restrictions").
- Failover is best-effort standby, not high availability.
- The 3B model only words sentences; the engine decides.

## Offline phone app (edge node serves the app)

The phone opens the app from its own edge node: **http://localhost:8080/#/m**. Browsers treat localhost as a secure page, so the app installs a service worker there and opens with no network at all.

| Situation | What the phone does |
|---|---|
| Laptop reachable | Edge proxies `/api/*` to the laptop; data auto-syncs on first open; "Laptop connected" chip |
| Laptop unreachable | Edge answers health and pending approvals from its cache (kept in SQLite, survives restarts); hold-to-approve signs the token and **queues it** in the edge outbox ("1 approval queued") |
| Laptop back | Edge delivers queued approvals within ~5 s; laptop ledger records them; chip returns to "Laptop connected" |
| No network, edge stopped | The installed app still opens from the service worker with the phone's own copy of the data |

Only full signed tokens can be queued; the 8-character code needs the laptop. A queued token still expires after 10 minutes and the laptop refuses it if the case changed (stale-state check), which the outbox shows as `refused`.

Automated test: `node scripts/offline-e2e.mjs <dir with edge_node.py and web/> [pairing-code]` (17 checks; cuts the laptop link with a relay, does not stop the real API).

### Phone setup (Termux)
1. `pkg install python curl` (once).
2. With USB tethering on: `curl -s http://10.195.200.192:8787/api/edge/setup.sh | bash -s <pairing code>`
3. Open **http://localhost:8080/#/m** in Chrome on the phone, pair, then "Add to Home screen".
4. Later: `~/spendsentinel-edge/run.sh` starts the edge node again.

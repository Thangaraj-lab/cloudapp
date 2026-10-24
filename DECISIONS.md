# DECISIONS

## v5: local product stack (backend, local cloud, local AI, edge node)
- **No Docker.** On 16 GB, Docker + WSL + Ollama + browser is too tight, and WSL networking makes the phone link harder. moto runs in-process as a threaded server and serves both S3 (export delivery) and EC2 (executor), so MinIO is not needed either.
- **Python engine is stdlib-only** (`server/engine/`), so the same files run on the laptop and in Termux. AES-GCM and Ed25519 are not in Python's standard library, so snapshots use `cryptography` when present and say so when it is not. Signing stays HMAC-SHA256, wire-compatible with the browser (`src/engine/approval.ts`).
- **Paths:** the project folder is deeper than Windows' 260-character limit, so file reads go through `paths.long()` (`\\?\` prefix). The venv (`%USERPROFILE%\.ssvenv`) and the SQLite DB (`%USERPROFILE%\.spendsentinel`) live at short paths.
- **One pairing key:** the laptop browser pushes its pairing code to the API at startup; a phone (`#/m`) never does. The API exposes only a hash of it.
- **Approvals with the API up:** "Approve on phone" creates the request on the API. The paired phone sees it live (polling plus server-sent events), signs after hold-to-approve and posts the token. The laptop continues on the `ledger approved` event. The 8-character code and paste stay as fallbacks. A laptop PIN approval is mirrored to the API as its own signed single-use request, recorded with the approver's name.
- **Live run** uses the API executor only for whole-bill cases. Service signals and Waste items keep the labelled simulation, since the API has no idle-resource inventory yet.
- **Learned verdict tree** (pure Python CART, depth ≤ 4) trains from labels but becomes active only at 20 labels; until then the rule-based model decides. The model JSON is HMAC-signed and the phone verifies it before use.
- **Local LLM:** llama3.2:3b (already installed). qwen3:4b was skipped because it emits thinking text. Facts in, one sentence out; any number not in the facts → template. 15 s timeout; the model is warmed up at startup.
- **Rules** now run on every import, in the browser and on the API (alert rules fire on the newest day).
- **Second approver** is enforced on "Approve here" above the policy's daily limit.

### Real-phone approval over USB tethering (verified on the owner's Android 10 phone)
Bugs found with on-device diagnostics (`/api/client-log`) and fixed:
1. Android Chrome fires pointerleave/cancel during a long press, so the hold never completed. Now only a real lift stops it; pointer capture is used and the long-press callout is blocked.
2. Laptop tabs adopted the API pairing code only on first connect, so open tabs showed stale QRs. They now re-check on every 5 s poll. Old builds that push their own code are ignored (`rotate: true` required).
3. The pair screen kept its first code when a new pairing link opened in the same tab. It now follows the link, and a code that doesn't match the laptop's published hash is refused.
4. The phone home crashed with no billing data (`addDays('')` in the estate). The estate is empty when there is no data.
5. A request the laptop had closed (used, reset, expired) could still be held on the phone. The phone now checks the laptop's open list and offers the newest request.
6. Request bodies in links are URI-encoded; `decode` also restores `+` read back as a space.
- The phone proves its pairing to the API (hash only, re-confirmed after laptop restarts), so the laptop knows the phone is paired without a manual "phone shows Paired" step.
- Display crashes on /m are caught by a route error screen that reports the error to the laptop.
- `scripts/phone-e2e.mjs` runs laptop + Android emulation over the tether address (18 checks). It shares the API with a real connected phone, so it ends by resetting and restoring the real pairing code.

## v4 — CLAUDE.md v2 rebuild with the Monestra palette (current)
Earlier sections below are history; where they conflict, this section wins.

### Theme
- Owner asked for the Pinterest "Monestra" pack: Brunswick Green #0C4137, Emerald #06D6A0, Polar #E5FBF6. It overrides the token table in CLAUDE.md §4; the meanings stay the same. Dark (default): bg #051A16, panels #0B2B25 at 72% (glass), text Polar, accent Emerald. Light: bg #EEF8F4, accent #067A5E (AA on white). Gradient emerald → deep green on the logo and primary marks only.
- Verdict colours chosen to stay distinct from the emerald accent: waste coral #FF8A7A, misconfig amber #F4BE6E, growth/verified lime #B9EE8C, neutral slate-green #6E9188.
- The cloud background image, stars, float/spin/pulse and the flowing-connector loops are gone (§4 motion rules). Only loading skeletons shimmer, and only while loading.
- Plus Jakarta Sans for headings, Inter for body, tabular numbers. Fraunces is no longer used.

### Engine
- **T14 ("toggle OFF ⇒ exactly 3 findings"):** `analyze().findings` now holds only whole-bill anomalies (the reference method): Sep 9, 12, 18. One service jumping inside a steady bill (CloudWatch, Sep 26) and always-on non-production spend move to `analyze().signals`. They are shown as "Service signals" under Cases and in Waste, so nothing is lost. With injection on: 6 findings (3 real + A, B, C).
- Detection parameters are unchanged (z > 3.5, min change $5, 7-day window); T1 reproduces the reference table without tuning.
- Duplicates: exact repeated lines are dropped in both `parseCsv` and streamed `ingest`. The sample has none, so the total stays $1,430.99 (T2).
- Non-usage rows (credit, tax, fee, purchase) are kept apart, with their count and billed total shown in Check and Data sources.
- `sniff.ts`: CSV, CSV.gz (DecompressionStream) and JSON (array or {rows|data|items|value}) are read. Parquet, Excel, ZIP and PDF get a plain-language guide instead of an error.
- `narrate.ts` (headlines, vs-normal captions, Founder Brief), `forecast.ts` (weekday median of last 14 days; do-nothing vs apply-fix), `rules.ts` (park-idle-nonprod, NAT spike, any-service spike; day-by-day backtest; alert rules report alerts, never invented savings).
- Pairing code is 8 characters (no 0/O/1/I). Phone approval works without a backend. The laptop shows an unsigned request (QR link). The phone signs it with the paired key after a 1-second hold and shows the token as a QR plus an 8-character code (the first 8 of the HMAC). The laptop re-signs its own request and compares, then runs the full `verify()`: TTL, nonce, state hash. The phone needs no billing data.
- **Simulated clock:** "Fast-forward 7 days" creates rows after the last real day for each applied change. Each row is the line's level before the change minus the estimated saving, with ±1% noise, tagged `injected: 'simulated'`. These rows are kept in `simRows`, never mixed into detection, and measured with the same `measure()` used for real data (T12). Real exports that cover those days still verify automatically.
- Waste items have no billing line of their own. Their measured saving is monthly cost minus residual, labelled as simulated clock.
- Live run is the simulated saga with make-before-break steps and "Simulate failure at step N". A failure rolls back in reverse, counts no saving, and leaves the case open with "Retry (needs a new approval)".

### Estate World (3D)
- All geometry comes from data (`world/model.ts`). Regions become platforms: the biggest is centred in front of the hub, the others alternate left and right. Services become buildings shaped by category from keywords: compute = stacked floors, database = cylinder stack, storage = low vault, network = arch, serverless = pods, other = block. Environment shows as a base ring (prod emerald, dev blue, test lavender, untagged slate). Health shows as a roof cap. Injected scenarios get a dashed amber outline.
- **Height is on a log scale.** EC2 is 98% of spend, so a linear scale would flatten 12 of 13 buildings. Every legend says "height: spend on a log scale". Beam thickness is proportional to √share.
- Matte PBR, soft key light with shadows, procedural Lightformer environment (no HDR download), N8AO + very low emissive-only bloom + vignette + ACES on high/medium; DOF only on focus shots on high; none on low.
- detect-gpu benchmarks are copied to `public/benchmarks` so tiering works offline (§2.3 "no runtime fetch to other hosts").
- `frameloop="demand"`. The camera rig requests frames until the shot settles, then stops. Rendering pauses when the tab is hidden. `window.__worldReady` is set after the second frame.
- **Reduced motion:** CLAUDE.md says to fall back to 2D. The owner explicitly wants a 3D product, so with reduced motion on, the 3D view stays but every animation jumps to its end state (no movement). The List view is one click away everywhere. WebGL missing or context lost ⇒ automatic List view with the same data.
- Labels are HTML overlays projected each frame. Higher priorities are placed first: hover, anomaly, focus, then spend. Overlapping labels hide. Labels stay below the chips along the top edge.
- Simulations: reveal plug-in (400 ms stagger, beams grow along their length, halo sweep "Learning normal…"). Time Machine heights by day with a 7-day ghost trail, and replay auto-pauses on anomaly days with a red roof light. C2 incident replay: Waste = lights off with a thick red beam; Misconfig = swollen amber pipe; Growth = balanced rise. C2 can also split floors by environment. C3 stress colour follows the What-if slider. C5 make-before-break plays forward and in reverse for rollback. C6 shrinks the beam to zero and the roof turns verified. D1 idle resources sit with lights off and park to dimmed. F2 ghost twin shows heights with the rule on. E4 shows the data dome and gate, the signed token passing through, and audit blocks that crack red on the tamper test. Approval seals a new audit block onto the chain.

### Product flow
- Routes follow CLAUDE.md §7 (`#/welcome … #/edge`, `#/m/...`). Returning users land on Overview. The Data-health chip opens Check, the dataset badge opens Data sources, and the phone chip opens Phone/Edge.
- Cases, waste items and the phone all use one subject adapter (`flow/subject.ts`), so C3–C6 are shared. Waste skips Understand.
- Ownership "Assign owner" stores an owner per untagged line (`owners`), with Undo.
- Reset demo and every one-click fix have Undo (toast), so no destructive button is final.

### Visual loop (critique summary)
- `scripts/shot.mjs` covers 21 desktop routes at 1440×900 and 8 phone routes at 390×844, with an optional light theme. `scripts/demo.mjs` walks the §13 demo path, including the two-device phone approval.
- Fixed after review rounds:
  - The camera rig never travelled under on-demand rendering, so focus shots looked at the hub.
  - Region platforms overlapped.
  - Reveal said 14 services against 13 in the chips (14 = service × region buildings).
  - The hub glow was too bright.
  - Every Waste row had a primary button (now ghost; one primary per screen).
  - The Stepper never highlighted the current step.
  - 3D was too tall on phones.
  - Labels slid under the top chip.
  - The receipt chart looked empty only because its draw-in animation was mid-way.
- Open: the main chunk is 503 kB (React, router, zustand, dexie, framer-motion). The 3D chunk is 1.27 MB, loaded only with 3D screens.

## Structure (v3): three spaces
- Estate (`/`): KPIs, one lens at a time (Skyline 3D, Trends, Breakdown, Idle), "Needs attention" rail, service drawer, and a Time Machine that replays the real billing days (auto-pauses on anomaly days). There is no fast-forward into the future: savings are only verified from real data.
- Case (`/case`, `/case/:id/:step`): one finding as Detect → Explain → Judge → Fix → Approve → Execute → Verify with one Continue button. Steps that don't apply (growth, stopped by itself, policy off) are locked with the reason. "A step failed · roll back" records a real rollback (status rolled-back; the problem reopens).
- Proof (`/proof/savings|security|policy`): ledger, data-flow + audit chain + tamper test on a copy, and the policy/budget/detection settings. ⚙ opens remaining settings (general, people, devices).
- First run: Import → analysis pipeline → Data health (score with fixes) → Estate. "Change data" and the health chip stay in the top bar.
- A fix that measured no saving, only noise, or was rolled back leaves the finding open (it still counts as at risk).
- Background: the supplied cloud artwork (`public/bg/cloud.webp`) under a dark tint; panels are translucent glass.

## Product shape (v2, business product)
- Upload-first: with no data the app shows a welcome screen with the importer; there is no bundled sample, injected scenario or paired demo data in the UI. (Engine helpers `inject.ts` / `idle.ts` paired data remain only for tests.)
- Navigation is five items: Overview, Findings, Actions, Data, Settings. Scanning happens instantly on import; approval is a side sheet on the finding; Action Live is the action page.
- Visual language: warm ivory / charcoal, Fraunces serif headings, Inter body, one teal action colour. Red = waste, amber = misconfig / pending, green = growth / verified.
- State is stored under a new key (`spendsentinel-v2`), so state from the demo build is not carried over.

## Data
- Upload accepts real exports (FOCUS, AWS CUR, Azure, GCP, generic) via `engine/ingest.ts`: header auto-mapping with an editable mapper, streamed parsing, rows rolled up to day/service/region/env/app. Environment/application come from their own columns or from the Tags JSON. "Usage rows only" (default on when a charge-type column exists) skips tax, credits and purchases. Only the first 200 set-aside rows are kept for display; the count is exact.
- Import is automatic by default (`autoMap` in `engine/ingest.ts`): columns are matched by header name, then the rest are inferred from the values of the first 200 rows (dates, numbers with cost-like names, region codes, tag JSON, charge types, and finally a repeating text column for service). That sample is validated; the file imports with no click only if date, service and cost are found and ≥ 90% of readable sample rows parse (≥ 98% when a required column was inferred from values). Otherwise the mapping opens with the guesses pre-filled and the problem stated. "Adjust mapping" reopens the same file; auto-import can be switched off under the drop zone.
- Billing currency is read from a currency column when present; "Show in ₹" uses the rate set in Settings (default 88).
- Data → "Add to current data" merges a newer export: days in the new file replace the same days. Finding ids are dates, so finding status and labels carry over between exports; Settings → "Remove all data" starts over.
- Optional utilization upload (`engine/utilization.ts`) powers idle resources and the risk simulation.

## Findings and actions
- Detection: trailing 7-day median + MAD, |z| > 3.5, min change 5/day (all editable in Settings). Consecutive flagged days are reported once, on the first day.
- Risk is shown only when CPU data matches the workload's environment/service; otherwise "Not assessed". No demo CPU profiles.
- Estimated saving = the extra cost per day on the affected line × 30, less an assumed 12% residual (storage, IPs). Labelled as an estimate.
- Action plans (`engine/plan.ts`) are real CLI commands for AWS (EC2, RDS, NAT → gateway endpoints), Azure VMs and GCP Compute; other services get manual steps. Billing data has no resource IDs, so step 1 resolves them by tag and later steps use `<placeholders>`.
- SpendSentinel holds no cloud credentials. Action Live runs pre-checks (approval, policy, data still present, data freshness, risk, rollback, commands), then the user runs the plan and marks the day it took effect.
- Verification is measured, not simulated: mean daily cost of the affected line for the 7 days before vs the 7 days after the effective date, from uploaded data. It waits until 7 days of data exist after the change and re-runs on every import.
- Approvals: HMAC-SHA256 single-use token, 10-minute TTL, bound to finding + cost + dataset fingerprint. The phone and laptop share a key derived from the pairing code; both must load the same billing file.
- 3D is used once, in Action Live, to show the actual change (resource billing → backup → parked; or NAT path → endpoint). Labels are DOM overlays; the scene remounts on theme change.

## Offline phone via the edge node (v6)
- The phone app is served by `edge_node.py` on localhost:8080 (bundle includes `dist/`), so the service worker works (secure context) without https certificates.
- Edge proxies the laptop API; offline it serves cached health/pending and queues signed approvals in an SQLite outbox, flushed by the heartbeat loop. The laptop's normal checks (signature, nonce, TTL, state hash) still decide.
- Mobile Overview reordered: status strip (laptop / runs on phone / works offline / queued), pending card, Leak Meter, 4 KPIs, Needs attention, collapsible Estate, links last. Phones opening `/` land on `/m`.
- Verified by `scripts/offline-e2e.mjs`: 17/17.

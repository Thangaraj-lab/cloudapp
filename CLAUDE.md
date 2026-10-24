# SpendSentinel — CLAUDE.md v2 (build guide for Claude Code)

Team TARS · QUANTIX 2K26 · PS12 "Cloud Cost Anomaly and Waste Finder". Owner: Raj (does not code; reviews and directs).
This file is the single source of truth. Read it fully before every phase. If something here conflicts with your habit, this file wins.

---

## 0. How to use (Raj — Tanglish)

1. `spendsentinel/` folder-la `CLAUDE.md` + `data/` podu. VS Code-la open pannu. Terminal-la `claude`.
2. Section 15-la irukkura prompts-ah **oru oru phase-ah** paste pannu. Ovvoru phase-um mudinjadhum browser-la paathu, `npm test` pass aachaa nu check pannu.
3. 3D phases-la (P8, P9) **screenshot loop** (Section 12) kandippa use pannanum. Adhu illaama 3D quality varaadhu.
4. Phone: `npm run dev -- --host` → phone-la `http://<laptop-ip>:5173/#/m`.

Rule for Claude Code: **Do not stop to ask questions. Decide, log the decision in DECISIONS.md, continue.** Stop only at the end of each phase and report.

---

## 1. Product

SpendSentinel reads a cloud billing export, finds cost anomalies, attributes each to service / environment / application / region, lists idle resources with net savings, **judges** each anomaly (Waste / Misconfig / Growth), recommends a **safe** fix, takes **approve-first** action, and **proves** the saving afterwards.

One line: *"Spike-ah kaattaadhu. Why-nu solli, safe-ah fix pannum."*

User's six questions = the six verbs that organise every screen:
**See → Understand → Decide → Act → Prove → Prevent.**

The whole engine runs **in the browser** on one bundled real dataset (no backend needed). Production later = FastAPI with the same engine interface.

Signature ideas (build these; they are what makes the product unique):
1. **Estate World** — one persistent 3D scene (account hub, region platforms, service buildings, cost beams). Every screen reuses it with a different camera shot.
2. **Time Machine** — global replay / scrub / fast-forward bar. Past = real data. Future = clearly-labelled projection / simulated clock.
3. **One-sentence headline** for every anomaly and every key number.
4. **Leak Meter** — calm ticking "$X/day leaking" that turns into "Stopped" after a fix.
5. **Verdict card** with confidence and "what would change this".
6. **Savings Receipt** — each verified saving is a receipt (before/after, hash, timeline).
7. **Never-again rule** with backtest ("would have saved $X last month").
8. **Founder Brief** — 60-second auto-written summary.
9. **Phone = approver and offline edge node** (hold-to-approve, token handoff).

---

## 2. HARD RULES

### 2.1 Banned claims (never in UI copy)
"₹0 cloud bill", "2-second migration", "zero-downtime", "active-active", "100% privacy", "30–50% savings", "AWS doesn't show root cause", "guaranteed", "DPDP compliant", "SOC 2", "first of its kind", "first self-hosted FinOps", "unhackable", "military-grade". Before finishing every phase run: `grep -riE "zero-downtime|unhackable|military-grade|guaranteed|SOC 2|DPDP|100% privacy" src` and fix hits.

### 2.2 Honest labels (visible)
- Real data: FOCUS 1.0 public sample, AWS account `11353890204`, Sept 2024, Usage rows, USD → badge **"Real sample data"**.
- Added by us → badge **"Injected demo scenario"** (also dashed outline in 3D).
- Cloud actions simulated → badge **"Demo mode — cloud actions simulated"** on Live run.
- Phone → **"Browser edge node (prototype)"**.
- Verdict engine = **"rule-based scoring model"**. Never say "AI-trained". It becomes a learned tree once customers confirm verdicts (labels counter shows this).
- Future values (forecast, fast-forward) → dashed + **"Projection"** / **"Simulated clock"**.
- 3D beams = **cost allocation, not network topology** (chip on Reveal and Overview: "Links show where cost flows, not network traffic").
- Currency: USD default; ₹ toggle uses `USD_INR = 88` labelled "demo rate".
- Never claim "who made the mistake" (needs CloudTrail).

### 2.3 Quality bar
- No lorem ipsum, no dead buttons, no fake numbers without a label. All numbers come from the engine.
- Works offline after first load (no CDN, no runtime fetch to other hosts).
- Desktop 1440×900 and phone 390×844 both pass.
- 3D is never the only way: every 3D view has a List/2D alternative. Auto-fallback if WebGL fails or `prefers-reduced-motion`.

---

## 3. Stack (install exactly)

```bash
npm create vite@latest spendsentinel -- --template react-ts
cd spendsentinel
npm i react-router-dom zustand framer-motion lucide-react echarts echarts-for-react \
      papaparse dexie date-fns @noble/hashes qrcode \
      @fontsource-variable/inter @fontsource/plus-jakarta-sans \
      three @react-three/fiber @react-three/drei @react-three/postprocessing \
      gsap maath detect-gpu
npm i -D tailwindcss @tailwindcss/vite @types/papaparse @types/three vitest playwright
npx playwright install chromium
```
Tailwind: `@tailwindcss/vite` plugin, `@import "tailwindcss";` in `src/index.css`. shadcn/ui optional: if init causes trouble, skip (max 5 min).
Router: **HashRouter** (static hosting, phone-friendly).
Crypto: use `@noble/hashes` (SHA-256, HMAC). **Do not use `crypto.subtle`** except AES-GCM vault when `window.isSecureContext`. On the phone the page is plain `http://192.168.x.x` (insecure context).

### Folder structure
```
spendsentinel/
  CLAUDE.md  DECISIONS.md
  data/ → copied to public/data/ (3 files)
  scripts/shot.mjs                 (Playwright screenshot tool, Section 12)
  src/
    engine/  parse validate map clean series detect explain verdict idle risk
             policy approval execute ledger audit inject forecast rules narrate
    store/            (zustand + dexie)
    world/            (3D) scene/ buildings/ beams/ shots/ sims/ quality/
    screens/          one folder per screen group (first-run, overview, cases, waste, proof, guardrails, system)
    components/       Stepper, LeakMeter, VerdictCard, TimeMachine, Drawer, Receipt, KPI, StateViews
    phone/            /m app (same engine + components, mobile layouts)
    viz/              echarts wrappers (sunburst, waterfall, band-chart, heatmap, scatter, fan, treemap)
    theme.ts
  tests/
```

---

## 4. Design system

Mood: calm, serious, trustworthy ops tool. Dark navy default, light supported. One accent. Colour = meaning.

| Token | Dark | Light |
|---|---|---|
| bg | #0D1626 | #F4F6F9 |
| panel | #14223A | #FFFFFF |
| border | #22344F | #DDE3EA |
| text | #EAF0F7 | #0E1A2B |
| muted | #9FB0C6 | #4F5F73 |
| accent / action (teal) | #5CC8BA | #0F9D8F |
| waste (coral) | #F0807A | #D9534F |
| misconfig / pending (amber) | #F2B766 | #C98A1B |
| growth / verified (green) | #7FD6A8 | #2E9E6B |
| neutral | #5B7491 | #9FB0C6 |

Type: Plus Jakarta Sans (H1 40, H2 28, 700–800), Inter (body 14/16, caption 12), tabular numbers.
Grid: 12 columns, max 1440, gutter 24. Left rail 72px (expands on hover), top bar 56px, Time Machine bar 72px.
Spacing 4/8 scale. Radius: panels 20, controls 10. Glass overlay panels on top of 3D: blur 16, 70% opacity, 1px border (never put dense text directly on 3D).
Buttons: one **primary** (teal) per screen, secondary ghost. No destructive buttons (everything has Undo).
Feedback: skeletons (no spinners), toasts with Undo, plain-language errors ("Row 214: cost 'N/A' is not a number. Skipped.").
Every number has a sentence: "$412 · 18% above normal".
Motion: 150–300 ms UI, 300–900 ms 3D, ease-out. **No bounce, wobble, spin or endless loops.** Count-up once. Respect `prefers-reduced-motion`.
Keyboard: Space play/pause, ←/→ step day, Esc close drawer.
A11y: AA contrast, visible focus ring, List view for 3D.

---

## 5. Data

Files in `public/data/`:
1. `walkthrough_daily_by_service_region_tag.csv` — 466 rows: `day, service, region, environment, application, billed_cost_usd` (`untagged` when missing).
2. `walkthrough_findings.json` — reference answers, **tests only**.
3. `azure_vm_sample.csv` — 4,176 VM stats (`vm_id, lifetime_days, max_cpu_pct, avg_cpu_pct, p95_of_max_cpu_pct, category, cores_bucket, memory_gb_bucket`). Public trace, **not linked** to the AWS account. Label "Paired demo data (public Azure VM trace stats)".

### Reference results the engine MUST reproduce (test T1)
Total usage cost **$1430.99**. Method: daily total; baseline = trailing 7-day median and MAD; `robust_z = 0.6745 × (x − median) / MAD`; flag if `|z| > 3.5` and absolute change ≥ minimum (default $5; tune only to reproduce the table, log in DECISIONS.md). Guard: `MAD = max(MAD, 0.01)`. First 7 days never flagged ("learning").

| Day | Cost | Trailing-7 median | z |
|---|---|---|---|
| 2024-09-09 | 13.77 | 1.24 | 7.2 |
| 2024-09-12 | 51.60 | 6.58 | 5.2 |
| 2024-09-18 | 84.94 | 46.00 | 4.7 |

Sep 9 jump = +$11.51/day: EC2 ≈101% of delta, `environment=dev` ≈101%, one application ≈102% (shares can exceed 100% when other lines dip; normalise the bar, tooltip "other lines moved slightly down"). Compute, never hardcode.

### Injected scenarios (`inject.ts`, toggle on Connect / Settings, all badged)
- **A Forgotten test server (Waste):** `i-0demo-staging-02`, dev, EC2, us-east-1, 14+ days, avg CPU 2.1%, max 6%, residual after stop = 12% of cost.
- **B NAT data-processing misconfig (Misconfig):** one-day 6× jump in NAT/data-processed, untagged. Recommend gateway/VPC endpoint.
- **C Healthy growth (Growth):** prod service +40% over 5 days, stays.
Additive only. Toggle OFF ⇒ exactly the 3 real findings. Toggle ON ⇒ + A, B, C.

---

## 6. Engine spec (pure TS, unit-tested, no React)

### Import pipeline (automatic validation) — `parse/validate/map/clean`
Stages, each emits progress + real counts for the A3 animation:
1. **Sniff:** CSV / `.csv.gz` / JSON. Parquet / xlsx → friendly message with export guide (not an error crash).
2. **Parse:** delimiter, encoding, header row auto-detect (Papaparse; gunzip via `DecompressionStream` when available).
3. **Map:** auto-match columns to canonical fields {date, cost, service, region, tags/env/app, resourceId, chargeCategory, currency}. Dictionaries for FOCUS (`ChargePeriodStart, BilledCost, ServiceName, RegionName, Tags, ResourceId, ChargeCategory, BillingCurrency`), AWS CUR (`lineItem/UsageStartDate, lineItem/UnblendedCost, product/ProductName, product/region, resourceTags/user:*`), Azure (`Date, CostInBillingCurrency, ServiceName, ResourceLocation, Tags`); fuzzy match. Minimum required: **date + cost + service**. If any missing ⇒ inline dropdown in A3 (never a separate dead-end).
4. **Validate/clean (with Undo):** date parse, numeric cost, **duplicates removed**, **non-Usage rows (credit / tax / adjustment) separated** (analysis uses Usage only; show their total), date gaps flagged, Tags JSON parsed, currency detected, bad rows → **quarantine** with row number and reason.
5. **Score:** Data Health 0–100 (completeness, validity, duplicates, date coverage, tag coverage) + traffic light. Each warning has a one-click Fix (+Undo).
Rules: never crash on bad input; idempotent (same file twice ⇒ same state; show SHA-256 fingerprint first 8); state persisted to IndexedDB (Dexie); data shorter than 14 days ⇒ warning "need ≥14 days for a reliable baseline".

### detect.ts
Input daily totals ⇒ `Finding {id, day, cost, baselineMedian, mad, z, deltaPerDay, severity}`. Severity: `|z|≥6` high, `≥4.5` medium, else low. Money at risk = `deltaPerDay × remainingDaysInMonth` ("if it continues"). Baseline band = median ± MAD.

### explain.ts
Delta vs trailing-7 mean per group. Tree: Service → Environment → Application (+ Region view). Node `{delta, share}`. Untagged separate. Output also a waterfall (baseline → top contributors → new total).

### narrate.ts
Template sentences from engine output: headline ("EC2 in dev added $11.51 a day since Sep 9. Looks like a forgotten test environment."), KPI captions, Founder Brief paragraphs. Deterministic, no LLM.

### verdict.ts — rule-based scoring
Features: devShare (dev/test/untagged), prodShare, networkShare (NAT/DataTransfer/CloudWatch/requests), sustained (new level persists ≥3 days), idleSignal, untaggedShare.
- Waste = 0.5·devShare + 0.3·(1−sustained) + 0.2·idleSignal
- Misconfig = 0.6·networkShare + 0.25·(1−sustained) + 0.15·untaggedShare
- Growth = 0.6·prodShare + 0.4·sustained
Verdict = argmax; confidence = top − second (High >0.35, Medium >0.15, Low). Always show top 3 reasons in words and "What would change this?". Confirm / Wrong-verdict writes a label (Dexie + audit); counter "Labels collected: N".

### idle.ts
Idle: avg CPU <5% and max CPU <20% for ≥14 days. Net saving = monthly cost − residual (EBS + snapshots + IP; 12% for injected; stated per-core demo price for Azure sample rows, labelled). Azure sample: top 25 VMs by `lifetime_days` with `avg_cpu_pct<5` and `p95_of_max_cpu_pct<20`.

### risk.ts (Web Worker, seeded RNG)
500 runs at traffic 1×/1.5×/3× (slider 1–4×): resample 14-day CPU history, scale, P99.5 peak. Pass if ≤80% with 20% headroom. Output histogram, per-multiplier pass/fail, overall Low/Med/High. Slider re-runs debounced <300 ms.

### forecast.ts
Month-end projection = actual-to-date + baseline-based daily forecast (median-of-last-14 by weekday). Two lines for fast-forward: "do nothing" vs "apply fix" (removes saving from fix date). Always dashed + "Projection".

### policy.ts
`autoApply:false` (dev/test only if enabled), `blockProd:true`, `requireRollbackPlan:true`, `maxActionCostPerDay` (above ⇒ second approver, simulated). Returns allow / needs-approval / deny + reason. Trust Ladder: Observe → Recommend → Approve-first (default) → Auto for dev/test only.

### approval.ts
Token `{findingOrWasteId, action, nonce(16B), issuedAt, expiresAt(+10 min), deviceId}` HMAC-SHA256 (`@noble/hashes`), per-device key in IndexedDB. Single-use (nonce recorded on consume). Stale re-check before execute. Display as QR (`qrcode`), pasteable text, and **8-character pairing code** (guaranteed path when the laptop cannot scan). Copy: "Prototype signing with a per-device key. Production uses hardware-backed keys."

### execute.ts (simulated saga)
Steps (≈600–900 ms each): 1 pre-check, 2 snapshot/backup tag, 3 start replacement (make-before-break), 4 health check, 5 switch/stop original, 6 verify metrics, 7 done. "Simulate failure at step N" ⇒ reverse rollback, no saving counted. Never say zero-downtime.

### ledger.ts
Entry `{id, source(case|waste), action, estimatedMonthlySaving, startedAt, status: pending|verified|rolled-back}`. **Fast-forward 7 days** advances the simulated clock; verified saving = baseline − new cost computed from the series after the action date. KPIs: Verified ₹/$ per month, Pending, Rolled back. Label "Simulated clock".

### rules.ts (Guardrails)
Rule = condition + action (e.g. "dev instance idle >7 days ⇒ propose stop"; "NAT bytes >5× baseline ⇒ alert"). Backtest runs the rule over the historical series and returns "would have saved $X" + counterfactual curve. If $0, say so.

### audit.ts
`hash = SHA256(prevHash + canonicalJSON(entry))`. `verify()` walks the chain. Events: dataset loaded, check passed, findings detected, verdict viewed/labelled, approval issued/consumed, execute step, rollback, ledger verified, rule created/enabled, policy changed. UI: chain visual, Verify, **Tamper test** (mutate one entry in memory ⇒ red + broken index), head hash with copy ("anchored off-device in production").

---

## 7. Screens, in flow order (hash routes)

Navigation: left rail **Overview · Cases · Waste · Proof · Guardrails**. Top bar: Data-health chip, Data sources, Phone/Edge chip, Notifications, Settings, Currency, Theme, Search, dataset badge. Time Machine bar appears only on: Overview, Service profile, Case Understand, Backtest, Savings (hidden on Approval and Live run).
Returning user (data in IndexedDB) lands on **#/overview**, not Welcome. "Change data" in top bar.

### A. First run (full-screen, no rail)
- **A1 Welcome `#/welcome`** — headline + 3 cards: **Try real sample** (primary), Upload my file, Connect cloud (disabled "soon"). Faint 3D estate behind.
- **A2 Connect `#/connect`** — large drop zone, "How to export" tabs (AWS / Azure / GCP), format chips, privacy line "Processed on this device". Drag-over state; wrong format ⇒ friendly guide.
- **A3 Check & Health `#/check`** — left: five live checks (Format, Columns, Dates, Cost, Tags) with counts. Missing required column ⇒ **inline** dropdown. On finish: right **Health score ring** + checklist (✓ ⚠ ✗), one-click Fix + Undo, quarantine list expandable. CTA **Looks good**.
- **A4 Estate Reveal `#/reveal`** — full-bleed 3D. Detected services plug into the hub one by one (stagger 400 ms) with cost beams; camera pulls back to the wide shot (6–8 s, Skip). Glass panel "**N services connected**" (name, spend, regions, tag coverage), chips `N services · N regions · N environments · N% untagged`, hover list ↔ building highlight both ways. Exclude / rename a service group. Final 3 s: baseline-halo sweep ("Learning normal…"). CTA **Enter Overview**. Chip: "Links show where cost flows, not network traffic". WebGL fail ⇒ 2D list version.

### B. See and Understand
- **B1 Overview `#/overview`** — 4 KPIs (Spend, vs normal, Money at risk, Verified savings). Centre: **Estate World** (Skyline) with lens switch **Skyline · Trends · Breakdown** (Breakdown = treemap + Pareto + calendar heatmap + tag coverage). Right rail "Needs attention" top 3 + total Leak Meter. Bottom Time Machine. CTA **Open top case**. No anomalies ⇒ "All normal" + Waste highlighted.
- **B2 Service drawer (popup)** — opens on building / list / treemap click. Right drawer 420 px (phone: bottom sheet). Name, spend, % of total, Δ vs normal, mini trend with anomaly marker, tabs Environment · Application · Region (bars, % share, untagged bucket), linked cases, idle resources, tag coverage. Camera eases to the building. Buttons **Open profile**, **Filter to this service**.
- **B3 Service profile `#/service/:id`** — headline sentence, trend + baseline band, breakdown, idle, owners, case history, mini 3D. CTA Open case / Add rule.
- **B4 Trends `#/trends`** — stacked area by service, top movers (delta vs previous period), forecast fan (dashed, "Projection"), filter chips. Click series ⇒ B3. <14 days ⇒ "Need 14 days".
- **B5 Ownership `#/ownership`** — headline "$X has no owner", tag-coverage ring, untagged table, owner by env/app, Assign owner.

### C. Cases (anomaly → decision → action). Stepper (7 dots) pinned: Detect · Explain · Judge · Fix · Approve · Execute · Verify.
- **C1 Inbox `#/cases`** — cards ranked by money at risk: sentence, verdict chip, confidence, status (new / approved / running / pending-verification / verified / rolled-back / rejected). Filters: verdict, status.
- **C2 Understand `#/case/:id/understand`** — left 45%: 3D **incident replay of the mistake** (forgotten server = lights off, beam still thick, meter ticking; NAT misconfig = thick pipe; growth = balanced rise). Right: three beats in one scroll — **What** (headline, baseline chart, Leak Meter) · **Where** (sunburst / waterfall, untagged bucket, region toggle) · **Verdict** (card, 3 score bars, top-3 reasons, "what would change this", Confirm / Wrong). CTA **Plan the fix** (Growth ⇒ **Mark as expected**, no execute).
- **C3 Fix plan `#/case/:id/fix`** (also entered from Waste) — left 3D target-building stress view; right action, **net saving**, risk badge, rollback plan, What-if slider (dot cloud). Source-aware: waste items skip Understand. High risk ⇒ amber warning + safer alternative. CTA **Review & approve**.
- **C4 Approval `#/case/:id/approve`** — policy result, checklist (rollback plan reviewed, owner notified), signed token + QR + 8-char code. Buttons **Approve here** / **Approve on phone** (inline **Pair phone** if not paired). Waiting state "Waiting for phone…" (TTL countdown, Cancel, "Approve here instead"). Prod-tagged ⇒ denied with reason. Expired / reused ⇒ clear message.
- **C5 Live run `#/case/:id/run`** — full-width 3D **make-before-break**: replacement module ghost → solid, health-check scan line, traffic lane switches, old module dims. Right: step timeline + log. Badge "Demo mode". **Simulate failure at step N** ⇒ reverse animation + "No saving counted".
- **C6 Result `#/case/:id/result`** — Leak Meter ⇒ **Stopped**; receipt preview (pending verification); CTA **Add never-again rule** ⇒ F2. Rolled back ⇒ explanation + Retry.

### D. Waste (PS12 core)
- **D1 Waste Finder `#/waste`** — headline "N idle · $X/month net". Table (resource, CPU sparkline, days idle, cost, **net saving**) + CPU-vs-cost scatter; mini 3D: idle = lights off. CTA **Park** ⇒ D2/C3. None ⇒ "No idle resources".
- **D2 Waste detail `#/waste/:id`** — CPU history, attached storage/IP, risk, **Ignore** (stored as label), CTA **Plan the fix** ⇒ C3.

### E. Prove
- **E1 Savings `#/proof/savings`** — KPIs, cumulative verified chart, receipt list, Time Machine, **Fast-forward 7 days** ("Simulated clock"). Empty ⇒ "Run your first fix".
- **E2 Receipt `#/proof/receipt/:id`** — before/after chart, saving, hash, timeline, Copy summary.
- **E3 Founder Brief `#/proof/brief`** — one page, 60-second read: spend, top 3 cases, saved, next action; Copy.
- **E4 Trust Center `#/proof/trust`** — 3D data-flow dome (raw data inside a glass dome; only the signed action passes the gate; counter "Raw rows uploaded: 0"), audit chain + Verify + **Tamper test**, attack tests (replay token ⇒ rejected; edit ledger ⇒ chain breaks; upload to unknown host ⇒ blocked by allowlist; expired token ⇒ rejected), AES-GCM vault (only if `isSecureContext`), honest "What this prototype does / does not do" panel.

### F. Prevent
- **F1 Guardrails `#/guardrails`** — Trust Ladder (default Approve-first), rule list with on/off, starter suggestions, CTA **Add rule**.
- **F2 Backtest `#/guardrails/backtest`** — Time Machine replay with **ghost twin** (translucent world with the rule on), "would have saved $X", CTA **Turn on**. $0 ⇒ say so honestly.

### G. System (top bar)
G1 Settings (detection thresholds z / min change / window with live re-scan, currency, approvers, Reset demo) · G2 Data sources (files, fingerprint, replace, injected toggle) · G3 Phone / Edge (pair via QR or code, Online/Offline, what works offline) · G4 Notifications (approval waiting, verified, rule fired) · G5 State views (empty / error / offline / loading, designed once and reused everywhere).

---

## 8. Estate World (3D) — art direction and spec

Concept: **architectural model on a dark studio table.** NOT neon/cyberpunk, NOT toy-like. No balls, particles, bounce, spin, endless loops.

Scene (all procedural geometry, driven only by engine data — nothing hand-placed):
- **Hub** at centre = the billing account.
- **Region platforms** around it (one per region found).
- **Service buildings** on platforms: height ∝ spend; silhouette by category from service name keywords — compute = stacked-floor tower, database = cylinder stack, storage = wide low vault, network = gateway arch, serverless = small pods, unknown/other = neutral block.
- Environment = base ring colour (prod / dev / test / untagged).
- **Cost beams** hub↔building: thin emissive teal lines, thickness ∝ spend share. Label: allocation, not topology.
- Health glow: neutral / red (waste) / amber (misconfig) / green (growth or verified).
- Injected scenarios: dashed outline + "Injected demo" tag.

Look: matte PBR, rounded-bevel boxes (`RoundedBox`), soft studio lighting, contact shadows, ambient occlusion (N8AO), ACES tone mapping, subtle environment reflection, fog gradient, slight depth of field on non-focus, bloom **very low and emissive-only**, vignette. Labels are HTML overlays (drei `Html`), not 3D text.
Camera: FOV ≈ 30°, near-isometric, damped (maath), **limited orbit angles**, named shots animated with GSAP/CameraControls: `reveal-wide`, `overview-3q`, `service-focus`, `case-side`, `liverun-profile`, `dome`.

### 3D simulations (all required, each data-driven)
| Moment | Simulation |
|---|---|
| A4 | Services plug in, beams connect, tickers count |
| A4 finale | Baseline-halo sweep, normal-range halo per building |
| Time Machine | Heights/glow update daily, **ghost trail** of last 7 days, beam thickness changes; **auto-pause on anomaly** with slow camera push-in + red edge-light on the roof + one-line sentence |
| C2 | Incident replay of the mistake (3 metaphors above) |
| C2 Where | Building floors split by env/app; spike floor highlighted |
| C3 | Target building stress level bar/colour follows What-if slider |
| C5 | Make-before-break sequence and reverse rollback |
| C6 | Beam thins to zero, building turns neutral/green, "Stopped" |
| D1 | Idle buildings lights-off, dim beams, ticking cost; Park powers down |
| F2 | Ghost twin world overlay, two cost curves split |
| E4 | Data dome and gate; tamper ⇒ audit block cracks red |
| Approval | New audit block "seals" onto chain |

### Quality tiers (detect-gpu)
High (laptop GPU: AO + bloom + soft shadows + DOF) · Medium (no DOF) · Low (no AO/bloom; phone). Cap DPR 1.5–2. Instanced meshes. `frameloop="demand"` (render only while animating / interacting). Pause when tab hidden. Lazy-load the world chunk; skeleton while loading (target <2 s). WebGL missing / context lost ⇒ automatic 2D fallback with identical data. Provide manual toggle "3D / List".

---

## 9. Time Machine (the 4th dimension)

Global bar (state in zustand: `date`, `playing`, `speed`, `mode`). Elements: scrubber (anomaly days = red ticks, learning days shaded), play/pause, speed 1× · 4× · 16×, step ±1 day, **Jump to next anomaly**, mode switch **Replay** (past, real) / **Projection** (future, dashed, "Simulated clock").
Everything on screen (KPIs, lens charts, 3D) reads `date` from the store, so scrubbing anywhere updates everything.
Projection shows two lines: *do nothing* vs *apply fix*. Backtest (F2) uses the same bar with a ghost twin.

---

## 10. Phone (`/#/m`) — same flow, thumb-first

Bottom tabs: **Overview · Cases · Waste · Proof · Rules**. Same engine/store/components, mobile layouts.
- Top of Overview: **"Approval waiting"** card (deep link to Approval). Edge chip: **Online / Offline · Data stays on this device · Last sync**.
- Overview: mini-skyline (service bars; 3D-lite Estate World on Medium/High phones, 2D bars on Low), KPI cards, compact Time Machine, tap ⇒ bottom sheet (half → full).
- Cases: swipeable stage cards (Understand, Fix, Approve, Run, Result), dots pinned top.
- **Approval = phone hero:** large **hold-to-approve** (1 s hold, vibrate if supported), token + QR + 8-char pairing code + TTL.
- Waste: cards, swipe to Park. Proof: receipts, Verify chain, Founder Brief. Rules: Trust Ladder + rules.
- Import works on phone (file picker, same auto-validation).
- Offline: after the page is loaded, verdicts and approval tokens work in airplane mode. Do not promise offline reload; say "keep the page open". (Service worker only on https/localhost; optional.)
- Laptop ↔ phone: only the **signed approval token** moves (QR display on phone; paste or pairing code on laptop). Camera scanning on laptop requires https — optional, not required.
- Safe areas, sticky bottom action in thumb zone, dark/light, reduced motion default.

---

## 11. Tests (vitest) — run `npm test` after every phase

T1 detect reproduces 3 reference findings (day, cost, median, z ±0.1) · T2 total = 1430.99 (±0.01) · T3 Sep 9 top service EC2, top env dev · T4 parse: bad rows quarantined, duplicates removed, idempotent, non-Usage separated · T5 map: FOCUS / CUR / Azure header sets auto-map; missing required column reported · T6 verdict returns a verdict for every finding, Sep 9 ⇒ Waste · T7 idle: injected A found, net = cost − 12% · T8 risk deterministic with seed, higher multiplier ⇒ ≥ risk · T9 approval: expired / reused / tampered rejected; prod denied by policy · T10 audit verify passes, mutation fails at right index · T11 execute: failure at step N ⇒ rollback, no ledger saving · T12 ledger: verified saving equals engine-computed difference · T13 rules backtest returns ≥0 and matches manual calc on a toy series · T14 injection toggle OFF ⇒ exactly 3 findings; ON ⇒ 6.

---

## 12. Visual feedback loop (mandatory for UI and 3D phases)

Create `scripts/shot.mjs` (Playwright, Chromium). It starts from a base URL and takes PNG screenshots of a list of hash routes at **1440×900** and **390×844**, into `shots/`. For WebGL in headless use args `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. For 3D shots, wait for a `window.__worldReady` flag set by the world, then wait 800 ms.
Loop per screen: (1) take screenshot, (2) look at it and critique against Sections 4, 7, 8 (hierarchy, contrast, overflow, clipped text, empty states, 3D legibility, label collisions, "does this look like a toy?"), (3) fix, (4) re-shoot. **Minimum 3 rounds for A4, B1, C2, C5; 2 rounds for the rest.** Write the final critique summary in DECISIONS.md.

---

## 13. Demo path (3 minutes)

A1 Try real sample → A3 auto-check + health → A4 services connect in 3D → B1 Skyline, press Play on Time Machine (auto-pause at Sep 9) → B2 service drawer → C2 incident replay + verdict → C3 slider → C4 phone approve (hold) → C5 live run, once with failure + rollback, once success → C6 Leak Meter Stopped → E1 Fast-forward 7 days → E2 receipt → F2 backtest → E4 tamper test.
Judge Q&A: "Backend?" — engine runs in browser for the demo; same interface moves to FastAPI. "Cloud action real?" — simulated, labelled; approve-first and rollback logic is real and tested. "Data real?" — public FOCUS sample from a real account; injected scenarios badged; utilization is paired public Azure stats.

---

## 14. Definition of done

- [ ] `npm run build` OK; `npm run preview -- --host` serves on LAN.
- [ ] Whole demo path works with real data; no console errors.
- [ ] T1–T14 pass; toggle OFF reproduces exactly 3 real findings.
- [ ] Every screen in Section 7 exists, reachable, has empty / error / loading states.
- [ ] Estate World renders at 60 fps on laptop GPU; 2D fallback works; phone usable.
- [ ] Phone: approve token accepted by laptop (noble hashes, no crypto.subtle).
- [ ] Banned-claims grep clean; honest labels visible.
- [ ] Works with Wi-Fi off after first load.
- [ ] Screenshots of every screen saved in `shots/` and reviewed.

### Cut list (if time short — never skip higher for lower)
1 engine + import validation + tests → 2 A1–A3 + B1 (2D Skyline) + B2 → 3 Cases C1–C6 + audit → 4 Waste → 5 Time Machine → 6 Proof → 7 Phone → 8 Guardrails/Backtest → 9 Trends/Ownership/Brief → 10 **3D Estate World** (Reveal + Skyline first, then sims) → 11 polish.
Rule: build the flow in 2D first; the 3D world is a skin over the same data and state. If a library fights you for more than 5 minutes, drop it.

---

## 15. Prompts for Claude Code (paste one at a time)

### P0 — scaffold + design system
```
Read CLAUDE.md fully (v2). Do Section 3: scaffold Vite React TS with the exact packages, Tailwind, fonts, HashRouter, all routes from Section 7 as placeholders (including /m), the design tokens and dark/light toggle from Section 4, app shell (left rail with 5 items, top bar with all items, Time Machine bar component stub, Drawer and StateViews components). Copy ./data/* into public/data/. Create DECISIONS.md and scripts/shot.mjs per Section 12. Take screenshots of the shell at both sizes and fix obvious problems. Stop and report the dev URL.
```

### P1 — import pipeline + A1–A3
```
Implement the import pipeline of Section 6 (sniff, parse, map with FOCUS/CUR/Azure dictionaries, validate/clean with Undo, quarantine, health score, Dexie persistence, fingerprint). Build A1 Welcome, A2 Connect, A3 Check & Health exactly as in Section 7 (live checks with real counts, inline column mapping, health ring, one-click fixes). Tests T2, T4, T5. Run npm test, screenshot A1–A3 (3 rounds on A3), fix. Stop.
```

### P2 — detection engine
```
Implement detect, explain, narrate, verdict, forecast per Section 6 and inject.ts scenarios per Section 5. Tests T1, T3, T6, T14 must pass (tune min-change only if needed, log it). Add a temporary debug page /#/debug listing findings and verdicts. Stop.
```

### P3 — overview (2D first) + service drawer
```
Build B1 Overview with the Skyline lens as a 2D tile/bar skyline for now (same data model the 3D will use), Trends and Breakdown lenses (ECharts), KPIs with count-up, Needs-attention rail, Leak Meter, and the global Time Machine bar wired to the store so scrubbing updates KPIs and charts. Build B2 service drawer, B3 service profile, B4 Trends, B5 Ownership. Screenshots, 2 rounds each, fix. Stop.
```

### P4 — cases
```
Build C1 Inbox, C2 Understand (What / Where / Verdict beats, charts, verdict card, Confirm/Wrong labels), C3 Fix plan (risk.ts worker + What-if slider + dot cloud), source-aware for Waste. Pinned 7-dot Stepper. Tests T8. 3D panels are placeholders for now. Screenshots 3 rounds on C2. Stop.
```

### P5 — approval, run, result, ledger, audit
```
Implement policy, approval, execute, ledger, audit engines (Section 6) and screens C4 Approval (token, QR, pairing code, waiting-for-phone state, policy denial), C5 Live run (2D diagram + timeline, failure/rollback), C6 Result (Leak Meter Stopped, receipt preview, Add never-again rule). Tests T9, T10, T11, T12. Wire audit events everywhere. Screenshots. Stop.
```

### P6 — waste + proof + guardrails + system
```
Build idle.ts and D1/D2 (reusing C3→C6). Build E1 Savings (fast-forward simulated clock), E2 Receipt, E3 Founder Brief, E4 Trust Center (2D data-flow, audit chain, Verify, Tamper test, attack tests, vault when secure), F1 Guardrails with Trust Ladder, F2 Backtest (rules.ts, T13), G1–G5. Screenshots. Stop.
```

### P7 — phone
```
Build /#/m per Section 10 with the same engine/store: tabs, Approval-waiting card, edge chip, swipeable case stages, hold-to-approve, token/QR/pairing code, import via file picker. No crypto.subtle outside isSecureContext. Run npm run dev -- --host and print the LAN URL. Screenshot at 390x844 for every phone screen, 2 rounds, fix. Stop so I can test on my phone.
```

### P8 — Estate World (3D foundation)
```
Build the Estate World per Section 8: data-to-scene mapper (regions→platforms, services→buildings by category, beams, health glow, injected outline), art direction, lighting, post-processing, camera shots, quality tiers with detect-gpu, 2D fallback, window.__worldReady flag. Replace the 2D Skyline on B1 (keep List toggle) and build A4 Estate Reveal with the plug-in sequence, services panel, baseline-halo finale. Use the screenshot loop: at least 3 rounds on A4 and B1, critiquing "does this look like a toy?" and legibility. Stop.
```

### P9 — 3D simulations
```
Add the 3D simulations of Section 8 in this order: Time Machine replay (ghost trail, auto-pause on anomaly), C2 incident replay (3 metaphors), C3 stress view bound to the slider, C5 make-before-break and rollback, C6 leak stops, D1 idle lights-off, F2 ghost twin, E4 data dome + tamper crack. Each must be driven by engine data and the store, with 2D fallbacks. Screenshot loop, 3 rounds on C2 and C5. Stop.
```

### P10 — polish + verify
```
Polish pass: motion audit (no bounce/loops), empty/error/loading states on every screen, reduced-motion, focus rings, AA contrast, 1440 and 390 layouts, banned-claims grep (Section 2.1), remove dead buttons. Then run npm test and npm run build, walk the Section 13 demo path in the browser, and print the Section 14 checklist with pass/fail per item. Fix all fails.
```

---

## 16. Common problems

- Phone hashes fail ⇒ you used `crypto.subtle` over http; use `@noble/hashes`.
- Phone can't reach laptop ⇒ same Wi-Fi/hotspot, `--host`, allow Node through the firewall (Private network).
- Headless 3D screenshots black ⇒ use the swiftshader args in Section 12 and wait for `__worldReady`.
- Real findings changed after injection ⇒ injection must be additive and toggle-gated; T1/T14 run with toggle OFF.
- 3D looks like a toy ⇒ remove glossy materials, bounce and saturated colours; lower bloom; widen camera FOV down to ~30°; reduce emissive area.
- Bundle too big ⇒ lazy-load `world/` and `echarts` per route.

## 17. After the hackathon (not now)

FastAPI + DuckDB backend with the same engine interface; live AWS CUR/FOCUS ingest; real Termux agent on the phone with SQLite and signed model JSON; hardware-backed keys; CloudTrail for "who changed what"; GCP/Azure; five design partners; pricing tested with them (Free / Pro / success fee on verified savings / Agency). North-star metric: **verified savings per month**.

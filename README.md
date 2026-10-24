# SpendSentinel

Cloud cost anomaly and waste finder. Reads a billing export in the browser, finds unusual days, explains them, judges them (Waste / Misconfig / Growth), runs approve-first fixes and proves the saving. Build guide: [CLAUDE.md](CLAUDE.md); decisions: [DECISIONS.md](DECISIONS.md).

```bash
npm install
npm run dev        # http://localhost:5173 (also listens on your LAN)
npm test           # vitest
npm run build
```

## Full local stack (backend, local cloud, local AI, phone edge node)

Architecture and workflow: [EDGE.md](EDGE.md).

```powershell
powershell -File scripts\setup-backend.ps1   # once: Python venv in %USERPROFILE%\.ssvenv
powershell -File scripts\start-local.ps1     # API :8787 (+ local cloud :5055) and web :5173
```

- The top bar shows **Local cloud** when the API is up; **Data sources** shows the local stack (bucket, instances, Ollama, edge node).
- Live run then executes for real against the local cloud (boto3 → moto EC2: snapshot, backup image, stop, verify; rollback on failure).
- **Connect cloud** on Welcome reads the newest export from the local S3 bucket.
- Without the API everything still works in the browser (labelled simulations).
- Python tests: `cd server; %USERPROFILE%\.ssvenv\Scripts\python -m pytest -q`

### Phone over USB tethering

1. Plug the phone in by USB → Settings → Hotspot & tethering → **USB tethering** on. Mobile data can stay off.
2. On the laptop, allow the ports once (admin PowerShell; new networks are "Public"):
   `New-NetFirewallRule -DisplayName "SpendSentinel dev" -Direction Inbound -Protocol TCP -LocalPort 5173,8787 -Action Allow -Profile Any`
3. Start the stack (above). Open **Phone / Edge** on the laptop: the QR code uses the tethered address (pick it in the dropdown if several appear).
4. Phone browser: scan → `http://<laptop-ip>:5173/#/m` → **Test connection**. Approval requests from the laptop appear on the phone instantly; after hold-to-approve the phone sends the signed token straight to the laptop.
5. Edge node (Termux, optional): install Termux from F-Droid, then
   `curl -s http://<laptop-ip>:8787/api/edge/setup.sh | bash -s <PAIRING-CODE>`
   (the 8-character code on Phone / Edge). It downloads the same engine, analyses the data on the phone (`http://127.0.0.1:8080/findings`), sends heartbeats, verifies the signed model and pushes encrypted snapshots. Stop it and the laptop logs "edge offline: laptop standby takes over" within 15 s.

## Test on your phone

1. Start the app on the laptop: `npm run dev`. The dev server listens on the network by default (`server.host = true`), and Vite prints a `Network:` URL such as `http://192.168.1.20:5173/`.
2. On the laptop, open **Phone / Edge** (phone icon in the top bar), or **Approve on phone** in a case, or "Use it on your phone" on the Welcome screen. The QR code there never points at `localhost` (on a phone, localhost is the phone itself). When you browse on `localhost`, the app asks the dev server for the laptop's network address (`GET /__lan`) and builds the link from it. If several networks are found, pick the one your phone is on; if none can be found, type the laptop IP (`ipconfig` → IPv4 under Wi-Fi). It is remembered.
3. Scan the QR code with the phone camera. On the phone, press **Test connection** (it calls `GET /__ping`) to check the laptop is reachable.
4. If the phone says "site can't be reached":
   - Phone and laptop must be on the same Wi-Fi or phone hotspot.
   - Allow Node.js through the Windows firewall on **Private** networks (and mark the Wi-Fi as Private).
   - College or guest Wi-Fi usually isolates devices from each other. Use a phone hotspot instead.
5. Approvals: the laptop's request link opens the approval on the phone. Hold to approve, then type the 8-character code it shows on the laptop. If links cannot be opened, copy the request text on the laptop ("Phone can't open links?") and paste it on the phone, or pair by typing the 8-character pairing code.

On a plain `http://192.168.x.x` address the browser treats the page as insecure: `crypto.subtle` and service workers are unavailable. Signing and approvals still work because they use `@noble/hashes` (pure JavaScript). Deploy over https for a full offline PWA and the encrypted vault.

`npm run preview` (after a build) also listens on the LAN and serves `/__lan` and `/__ping`.

// Offline test of the phone edge node, as it runs in Termux:
//   phone (Pixel 7 emulation) opens http://localhost:8080/#/m served by edge_node.py,
//   the edge reaches the laptop API through a relay we can cut to simulate "laptop unreachable".
// Usage: node scripts/offline-e2e.mjs <edge-dir with edge_node.py + web/> [pairing-code]
// Needs the laptop API on 127.0.0.1:8787. Uses ports 8080 (edge) and 8788 (relay).
import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const edgeDir = process.argv[2]
const code = process.argv[3] ?? '3D28NRKG'
const py = process.env.PY ?? 'python'
const work = mkdtempSync(join(tmpdir(), 'ss-offline-'))
const api = (p, body) => fetch('http://127.0.0.1:8787/api' + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then((r) => r.json())
const edge = (p) => fetch('http://127.0.0.1:8080' + p).then((r) => r.json())
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } return null }

// The relay stands in for the USB/Wi-Fi link: killing it makes the laptop unreachable for the edge.
const relaySrc = join(work, 'relay.py')
writeFileSync(relaySrc, `import socket, threading
def pipe(a, b):
    try:
        while (d := a.recv(65536)):
            b.sendall(d)
    except OSError:
        pass
    finally:
        try: b.shutdown(socket.SHUT_WR)
        except OSError: pass
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(("127.0.0.1", 8788)); srv.listen(50)
while True:
    c, _ = srv.accept()
    try:
        u = socket.create_connection(("127.0.0.1", 8787))
    except OSError:
        c.close(); continue
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
`)
let relay = null
const linkUp = () => { relay = spawn(py, ['-I', relaySrc], { stdio: 'ignore' }) }
const linkDown = () => { relay?.kill(); relay = null }
const edgeProc = spawn(py, ['edge_node.py', '--laptop', 'http://127.0.0.1:8788', '--code', code, '--device', 'phone-offline-test'], {
  cwd: edgeDir, env: { ...process.env, SPENDSENTINEL_EDGE_HOME: join(work, 'home'), PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
})
const edgeLog = []
edgeProc.stdout.on('data', (d) => edgeLog.push(String(d).trim()))
edgeProc.stderr.on('data', (d) => edgeLog.push(String(d).trim()))
const stopAll = () => { linkDown(); edgeProc.kill() }
process.on('exit', stopAll)

await api('/reset', {})
await api('/pairing', { code, rotate: true })
linkUp()
check('edge node syncs the dataset from the laptop', !!(await until(async () => (await fetch('http://127.0.0.1:8080/api/dataset.csv')).ok, 30000)))

const browser = await chromium.launch({ channel: 'chromium' })
const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:8080' })
const phone = await ctx.newPage()
const errors = []
phone.on('pageerror', (e) => errors.push(e.message))
const cdp = await ctx.newCDPSession(phone)
const hold = async () => {
  const btn = phone.getByRole('button', { name: 'Hold to approve' })
  await btn.waitFor({ timeout: 10000 })
  const b = await until(() => btn.boundingBox(), 5000)
  const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
  await phone.waitForTimeout(1300)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// 1. The app is served by the phone itself and installs for offline use.
await phone.goto('/#/m/pair/' + code)
await phone.getByRole('button', { name: /^Pair/ }).click({ timeout: 15000 })
await phone.waitForURL(/#\/m$/, { timeout: 8000 }).catch(() => {})
check('service worker controls the page (installed offline copy)', !!(await until(async () => { await phone.reload(); return phone.evaluate(() => !!navigator.serviceWorker.controller) }, 20000)))
check('status strip: laptop connected, runs on this phone, works offline',
  !!(await until(async () => (await phone.getByText('Laptop connected').isVisible()) && (await phone.getByText('Runs on this phone').isVisible()) && (await phone.getByText('Works offline').isVisible()), 15000)))
check('data auto-synced from the laptop (overview shows cases)', !!(await until(() => phone.getByRole('heading', { name: /need you|All normal/ }).isVisible(), 20000)))
await phone.screenshot({ path: join(work, '1-online.png') })

// 2. The laptop asks for approval while the link is up; the phone caches the request.
const req = await api('/approvals/request', { findingId: 'f-2024-09-18', device: 'laptop · offline test' })
check('laptop issued an approval request', !!req.body)
const card = phone.getByText('Approval waiting · from the laptop')
check('approval card reaches the phone through the edge', await card.waitFor({ timeout: 15000 }).then(() => true, () => false))
await until(async () => (await edge('/api/approvals/pending')).pending?.length, 10000)
await new Promise((r) => setTimeout(r, 6000)) // one more edge loop so the request is cached

// 3. Cut the link: the phone keeps working and queues the approval.
linkDown()
check('phone shows "Laptop offline"', !!(await until(() => phone.getByText('Laptop offline').isVisible(), 30000)))
await card.click({ timeout: 10000 })
await hold()
const said = await phone.getByText(/Saved on this phone|Sent to the laptop|Not sent/).first().textContent({ timeout: 10000 }).catch(() => 'nothing')
check('hold-to-approve while offline is saved on the phone', /Saved on this phone/.test(said), said.trim())
check('edge outbox holds 1 queued approval', (await edge('/api/edge/outbox')).outbox.filter((o) => o.status === 'queued').length === 1)
await phone.goto('/#/m')
check('status strip shows "1 approval queued"', !!(await until(() => phone.getByText('1 approval queued').isVisible(), 15000)))
await phone.screenshot({ path: join(work, '2-offline-queued.png') })
check('laptop has not received it yet', !(await api('/ledger')).ledger?.some?.((l) => l.findingId === 'f-2024-09-18'))

// 4. Link back: the edge delivers the queued approval; the laptop records it.
linkUp()
check('queued approval delivered when the laptop is back', !!(await until(async () => (await edge('/api/edge/outbox')).outbox.some((o) => o.status === 'sent'), 30000)),
  JSON.stringify((await edge('/api/edge/outbox')).outbox[0] ?? {}).slice(0, 160))
const ledger = await api('/ledger')
check('laptop ledger shows the phone approval', JSON.stringify(ledger).includes('f-2024-09-18'))
check('status strip back to "Laptop connected"', !!(await until(() => phone.getByText('Laptop connected').isVisible(), 20000)))

// 5. No network and no edge at all: the installed app still opens.
edgeProc.kill()
await ctx.setOffline(true)
await phone.reload().catch(() => {})
check('app opens with no network and no edge (service worker)', !!(await until(() => phone.getByText('SpendSentinel').first().isVisible(), 15000)))
check('cases still visible offline (data on the phone)', !!(await until(() => phone.getByRole('heading', { name: /need you|All normal/ }).isVisible(), 10000)))
await phone.screenshot({ path: join(work, '3-airplane.png') })
await ctx.setOffline(false)

check('no page errors on the phone', errors.length === 0, errors.join(' | '))
await browser.close()
stopAll()
await api('/reset', {})
await api('/pairing', { code, rotate: true })
console.log(`screenshots: ${work}`)
if (results.some((r) => !r.ok)) console.log('edge log:\n' + edgeLog.join('\n'))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)

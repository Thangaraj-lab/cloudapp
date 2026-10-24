// Phone approval with a real touch long-press (Android-style), through the LAN address like the phone.
// Usage: node scripts/touch-test.mjs http://10.195.200.192:5173/ <PAIRING-CODE> <findingId>
import { chromium, devices } from 'playwright'

const [base = 'http://localhost:5173/', code, fid = 'f-2024-09-18'] = process.argv.slice(2)
const api = 'http://127.0.0.1:8787/api'
const req = await (await fetch(api + '/approvals/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findingId: fid, device: 'phone' }) })).json()
if (!req.body) { console.log('request refused:', req.policy?.reasons); process.exit(1) }

const browser = await chromium.launch({ channel: 'chromium' })
const ctx = await browser.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(base + '#/m/pair/' + code)
await page.getByRole('button', { name: /^Pair/ }).click()
await page.goto(base + `#/m/approve/${fid}?r=${req.body}`)
const btn = page.getByRole('button', { name: 'Hold to approve' })
const b = await btn.boundingBox()
const cdp = await ctx.newCDPSession(page)
const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
await page.waitForTimeout(1300)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(1500)
console.log('phone says:', (await page.locator('text=/Sent to the laptop|Not sent/').first().textContent().catch(() => 'nothing')).trim())
await browser.close()

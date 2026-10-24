// Two-device test of the phone approval path, as on the real hardware:
//   laptop = desktop browser on localhost, phone = Android (Pixel 7) emulation on the LAN/tether address.
// Usage: node scripts/phone-e2e.mjs <lan-base e.g. http://10.195.200.192:5173/> [final-pairing-code]
import { chromium, devices } from 'playwright'

const lan = (process.argv[2] ?? 'http://localhost:5173/').replace(/#.*$/, '')
const finalCode = process.argv[3]
const local = 'http://localhost:5173/'
const api = (p, body) => fetch('http://127.0.0.1:8787/api' + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then((r) => r.json())
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }
const pairLink = async (pg) => { await pg.goto(local + '#/edge'); await pg.waitForFunction(() => document.querySelector('[data-phone-link]')?.getAttribute('data-phone-link')?.includes('/m/pair/'), null, { timeout: 15000 }); return pg.locator('[data-phone-link]').first().getAttribute('data-phone-link') }
const codeOf = (link) => link.split('/m/pair/')[1]

await api('/reset', {})
const browser = await chromium.launch({ channel: 'chromium' })
const laptop = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] })
const phone = await phoneCtx.newPage()
const errors = []
for (const [n, p] of [['laptop', laptop], ['phone', phone]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`))
const cdp = await phoneCtx.newCDPSession(phone)
const hold = async () => {
  const btn = phone.getByRole('button', { name: 'Hold to approve' })
  await btn.waitFor({ timeout: 10000 })
  let b = null
  for (let i = 0; i < 20 && !b; i++) { b = await btn.boundingBox(); if (!b) await phone.waitForTimeout(250) }
  if (!b) throw new Error('hold button has no box; page: ' + (await phone.locator('main').innerText()).slice(0, 300))
  const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
  await phone.waitForTimeout(1300)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// Laptop: load the sample.
await laptop.goto(local + '#/welcome')
await laptop.getByText('Try real sample').click()
await laptop.getByRole('button', { name: /Looks good/ }).click({ timeout: 20000 })
await laptop.getByRole('button', { name: /Enter Overview/ }).click()

// 1. The laptop's pairing QR shows the API's current code.
const link1 = await pairLink(laptop)
const apiCode = (await fetch(local + 'api/pairing').then((r) => r.json())).code
check('laptop QR shows the API pairing code', codeOf(link1) === apiCode, codeOf(link1))
check('QR uses the tether/LAN address, not localhost', !/localhost|127\.0\.0\.1/.test(link1), link1.split('#')[0])

// 2. A stale code is refused on the phone.
await phone.goto(lan + '#/m/pair/ZZZZ2222')
await phone.waitForTimeout(2500)
await phone.getByRole('button', { name: /^Pair/ }).click()
check('phone refuses a stale code', await phone.getByText('not the laptop’s current code').isVisible().catch(() => false))

// 3. Pair from the laptop's link; the laptop learns it automatically.
await phone.goto(lan + '#/' + link1.split('#/')[1])
await phone.waitForTimeout(2500)
await phone.getByRole('button', { name: /^Pair/ }).click()
await phone.waitForURL(/#\/m$/, { timeout: 5000 }).catch(() => {})
await phone.waitForTimeout(6500)
check('phone shows no pairing warning', !(await phone.getByText(/Paired with a different code|Not paired with this laptop/).isVisible().catch(() => false)))
check('API knows the phone holds the current code', (await api('/health')).pairedPhone?.current === true)

// 4. Live approval: laptop asks, phone holds, laptop continues by itself.
await laptop.goto(local + '#/case/f-2024-09-18/approve')
await laptop.getByRole('checkbox').first().waitFor()
for (const cb of await laptop.getByRole('checkbox').all()) await cb.check()
await laptop.getByRole('button', { name: /Approve on phone/ }).click()
check('laptop skips manual pairing (verified)', await laptop.getByText('Waiting for phone').isVisible({ timeout: 8000 }).catch(() => false))
await phone.goto(lan + '#/m')
const card = phone.getByText('Approval waiting · from the laptop')
check('approval card reaches the phone', await card.waitFor({ timeout: 12000 }).then(() => true, () => false))
await card.click()
await hold()
const said = await phone.getByText(/Sent to the laptop|Not sent/).first().textContent({ timeout: 8000 }).catch(() => 'nothing')
check('phone hold-to-approve is accepted by the laptop', /Sent to the laptop/.test(said), said.trim())
check('laptop moves to Run by itself', await laptop.waitForURL(/\/run$/, { timeout: 10000 }).then(() => true, () => false))
const usedUrl = phone.url()
await phone.goto(lan + '#/m')
await phone.goto(usedUrl)
check('a used request shows “no longer open” (no hold button)', await phone.getByText('no longer open on the laptop').waitFor({ timeout: 8000 }).then(() => true, () => false))
await laptop.getByRole('button', { name: /Run on local cloud/ }).click()
check('action runs on the local cloud', await laptop.getByRole('button', { name: /See the result/ }).waitFor({ timeout: 20000 }).then(() => true, () => false))
const inst = (await api('/cloud/instances')).instances.filter((i) => i.environment === 'dev' && i.application === 'BrightPathMatrix')
check('instance is stopped in the local cloud', inst.length > 0 && inst.every((i) => i.state === 'stopped'), inst.map((i) => `${i.id}:${i.state}`).join(' '))

// 5. Code change: an old laptop tab updates, the phone flags it, re-pairing fixes it.
const oldTab = await laptop.context().newPage()
const before = await pairLink(oldTab)
await laptop.goto(local + '#/edge')
await laptop.getByRole('button', { name: /New code/ }).click()
await laptop.waitForTimeout(1500)
const rotated = (await fetch(local + 'api/pairing').then((r) => r.json())).code
check('New code changes the API code', rotated !== codeOf(before), `${codeOf(before)} → ${rotated}`)
await oldTab.waitForFunction((c) => document.querySelector('[data-phone-link]')?.getAttribute('data-phone-link')?.endsWith(c), rotated, { timeout: 12000 }).catch(() => {})
check('an old laptop tab shows the new code within 12 s', (await oldTab.locator('[data-phone-link]').first().getAttribute('data-phone-link')).endsWith(rotated))
await phone.goto(lan + '#/m')
check('phone warns that its code is now different', await phone.getByText('Paired with a different code').waitFor({ timeout: 12000 }).then(() => true, () => false))
await phone.goto(lan + '#/m/pair/' + rotated)
await phone.waitForTimeout(2500)
await phone.getByRole('button', { name: /^Pair/ }).click()
await phone.waitForTimeout(6500)
check('after re-pairing the warning is gone', !(await phone.getByText('Paired with a different code').isVisible().catch(() => false)))
check('API sees the re-paired phone as current', (await api('/health')).pairedPhone?.current === true)

check('no page errors on laptop or phone', errors.length === 0, errors.join(' | '))
await browser.close()
if (finalCode) { await api('/pairing', { code: finalCode, rotate: true }); console.log(`pairing code set to ${finalCode} for the real phone`) }
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)

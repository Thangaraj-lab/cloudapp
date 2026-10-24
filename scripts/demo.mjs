// Walks the CLAUDE.md §13 demo path in a real browser and screenshots each step into shots/demo-*.png.
// Usage: node scripts/demo.mjs [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = (process.argv[2] ?? 'http://localhost:5173/').replace(/#.*$/, '')
const out = new URL('../shots/', import.meta.url)
mkdirSync(out, { recursive: true })
const path = (f) => new URL(f, out).pathname.replace(/^\/([A-Z]:)/, '$1')

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: path(`demo-${name}.png`) }); console.log('  demo-' + name) }
const step = (t) => console.log('• ' + t)

// Fresh backend state (instances running again, empty ledger) when the API is up.
for (let i = 0; i < 20; i++) {
  const r = await fetch(base + 'api/reset', { method: 'POST' }).catch(() => null)
  if (r?.ok) { console.log('  backend reset'); break }
  if (!r || r.status === 404) { console.log('  no backend (browser-only run)'); break }
  await new Promise((res) => setTimeout(res, 1000))
}
step('A1 → A3 → A4: sample, check, reveal')
await page.goto(base + '#/welcome')
await page.getByText('Try real sample').click()
await page.getByRole('button', { name: /Looks good/ }).click({ timeout: 20000 })
await page.getByRole('button', { name: /Enter Overview/ }).click()

step('B1: replay pauses on Sep 9')
await page.getByRole('button', { name: 'Previous day' }).waitFor()
await page.evaluate(() => { location.hash = '#/overview' })
await page.keyboard.press('Home')
for (let i = 0; i < 40 && !(await page.getByText('Paused on an unusual day').isVisible().catch(() => false)); i++) {
  await page.getByRole('slider', { name: 'Billing day' }).fill('0').catch(() => {})
  await page.getByRole('button', { name: 'Play' }).click().catch(() => {})
  await page.waitForTimeout(2500)
}
console.log('  paused:', (await page.getByText('Paused on an unusual day').textContent().catch(() => 'no pause')).slice(0, 120))
await shot('b1-paused')

step('C2 → C3 → C4: understand, fix, approve here with a PIN')
const caseId = 'f-2024-09-18'
await page.goto(base + `#/case/${caseId}/understand`)
await shot('c2-understand')
await page.getByRole('button', { name: /Plan the fix/ }).click()
await shot('c3-fix')
await page.getByRole('button', { name: /Review & approve/ }).click()
await page.getByPlaceholder('Name and role, e.g. Raj (CTO)').fill('Raj (CTO)')
await page.getByPlaceholder('4–6 digit PIN').fill('2468')
await page.getByRole('button', { name: /Save profile/ }).click()
await page.getByRole('checkbox').first().waitFor(); for (const cb of await page.getByRole('checkbox').all()) await cb.check()
await page.getByPlaceholder('PIN', { exact: true }).fill('1111')
await page.getByRole('button', { name: /Approve and sign/ }).click()
console.log('  wrong PIN →', await page.getByText('Wrong PIN.').isVisible())
await page.getByPlaceholder('PIN', { exact: true }).fill('2468')
await shot('c4-approve')
await page.getByRole('button', { name: /Approve and sign/ }).click()
await page.waitForURL(/\/run$/, { timeout: 10000 })

step('C5: live run with failure at step 4 → rollback')
await page.locator('select').selectOption('4')
await page.getByRole('button', { name: /Start live run|Run on local cloud/ }).click()
await page.waitForTimeout(2600)
await shot('c5-running')
await page.getByText('Rolled back.').waitFor({ timeout: 15000 })
await shot('c5-rolled-back')
await page.getByRole('button', { name: /See the result/ }).click()
await page.getByRole('button', { name: /Retry/ }).click()
await page.getByRole('checkbox').first().waitFor(); for (const cb of await page.getByRole('checkbox').all()) await cb.check()
await page.getByPlaceholder('PIN', { exact: true }).fill('2468')
await page.getByRole('button', { name: /Approve and sign/ }).click()
await page.waitForURL(/\/run$/, { timeout: 10000 })

step('C5 success → C6 result')
await page.getByRole('button', { name: /Start live run|Run on local cloud/ }).click()
await page.getByRole('button', { name: /See the result/ }).click({ timeout: 15000 })
await shot('c6-result')

step('E1 fast-forward → E2 receipt')
await page.goto(base + '#/proof/savings')
await page.getByRole('button', { name: /Fast-forward 7 days/ }).click()
await shot('e1-savings')
await page.locator('button', { hasText: 'A-002' }).click()
await shot('e2-receipt')

step('F2 backtest, E4 tamper test + attack tests')
await page.goto(base + `#/guardrails/backtest?from=${caseId}`)
await shot('f2-backtest')
await page.goto(base + '#/proof/trust')
await page.getByRole('button', { name: /Tamper test/ }).click()
await page.getByRole('button', { name: /^Run$/ }).click()
await shot('e4-trust')

step('Phone approval round trip (laptop request → phone hold → 8-char code)')
await page.goto(base + '#/case/f-2024-09-12/approve')
await page.getByRole('checkbox').first().waitFor(); for (const cb of await page.getByRole('checkbox').all()) await cb.check()
await page.getByRole('button', { name: /Approve on phone/ }).click()
const code = await page.locator('[data-pairing-code]').getAttribute('data-pairing-code')
await page.getByRole('button', { name: /phone shows/i }).click()
const reqUrl = await page.locator('[data-request-url]').getAttribute('data-request-url')
await shot('c4-phone-waiting')
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const p = await phone.newPage()
p.on('pageerror', (e) => errors.push('phone: ' + e.message))
await p.goto(base + '#/m/pair/' + code)
await p.getByRole('button', { name: /^Pair/ }).click()
await p.goto(base + reqUrl.slice(reqUrl.indexOf('#')))
const hold = p.getByRole('button', { name: 'Hold to approve' })
const box = await hold.boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await p.mouse.down(); await p.waitForTimeout(1300); await p.mouse.up()
const short = (await p.locator('.font-mono').filter({ hasText: /^[0-9A-F]{8}$/ }).first().textContent()).trim()
await p.screenshot({ path: path('demo-phone-approved.png') }); console.log('  demo-phone-approved, code', short)
// With the backend up the phone sends the token itself and the laptop moves on live;
// without it, the laptop types the 8-character code.
const auto = await page.waitForURL(/\/run$/, { timeout: 6000 }).then(() => true, () => false)
if (!auto) {
  await page.getByPlaceholder('8-character code').fill(short)
  await page.getByRole('button', { name: 'Use code' }).click()
  await page.waitForURL(/\/run$/, { timeout: 10000 })
}
console.log(`  laptop accepted the phone approval (${auto ? 'live via API' : 'typed code'}) →`, page.url().split('#')[1])
if (auto) {
  await page.getByRole('button', { name: /Run on local cloud/ }).click()
  await page.getByRole('button', { name: /See the result/ }).waitFor({ timeout: 20000 })
  console.log('  phone-approved action executed on the local cloud')
}
await phone.close()

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No page errors.')
await browser.close()

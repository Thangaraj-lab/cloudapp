// Visual feedback loop (CLAUDE.md §12): screenshots of hash routes at 1440×900 and 390×844.
// Usage: node scripts/shot.mjs [baseUrl] [routeFilter] [light]
//   baseUrl defaults to http://localhost:5173/ ; routeFilter is a substring to shoot fewer routes;
//   "light" shoots the light theme (files prefixed light-).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = (process.argv[2] ?? 'http://localhost:5173/').replace(/#.*$/, '')
const filter = process.argv[3] ?? ''
const theme = process.argv[4] === 'light' ? 'light' : 'dark'
const out = new URL('../shots/', import.meta.url)
mkdirSync(out, { recursive: true })

const DESKTOP = [
  'welcome', 'connect', 'check', 'reveal', 'overview', 'service/Amazon%20Elastic%20Compute%20Cloud', 'trends', 'ownership',
  'cases', 'case/f-2024-09-09/understand', 'case/f-2024-09-09/fix', 'case/f-2024-09-09/approve',
  'waste', 'proof/savings', 'proof/brief', 'proof/trust', 'guardrails', 'guardrails/backtest', 'settings', 'sources', 'edge',
]
const PHONE = ['m', 'm/cases', 'm/case/f-2024-09-09', 'm/waste', 'm/proof', 'm/rules', 'overview', 'case/f-2024-09-09/understand']
const WORLD = /reveal|overview|service\/|understand|fix|waste$|backtest|trust|^m$/

// The full Chromium build (new headless mode) renders WebGL through SwiftShader.
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function seed(page) {
  // Load the real sample once; state persists in this context's IndexedDB.
  await page.goto(base + '#/welcome')
  await page.getByText('Try real sample').click()
  await page.getByRole('button', { name: /Looks good/ }).click({ timeout: 20000 })
  await page.waitForURL(/#\/reveal/)
  await page.getByRole('button', { name: /Enter Overview/ }).click()
  await page.waitForURL(/#\/overview/)
}

async function shoot(page, route, tag) {
  await page.goto(base + '#/' + route)
  await page.waitForLoadState('networkidle').catch(() => {})
  if (WORLD.test(route)) await page.waitForFunction(() => window.__worldReady === true, null, { timeout: 15000 }).catch(() => console.warn('  no __worldReady for', route))
  await page.waitForTimeout(800)
  const file = `${theme === 'light' ? 'light-' : ''}${tag}-${route.replace(/[^a-z0-9]+/gi, '_')}.png`
  await page.screenshot({ path: new URL(file, out).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: false })
  console.log('  ' + file)
}

for (const [tag, viewport, routes] of [['d', { width: 1440, height: 900 }, DESKTOP], ['p', { width: 390, height: 844 }, PHONE]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('  pageerror:', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.error('  console:', m.text().slice(0, 200)) })
  await seed(page)
  console.log(tag === 'd' ? 'Desktop 1440×900' : 'Phone 390×844')
  for (const r of routes) if (r.includes(filter)) await shoot(page, r, tag)
  await ctx.close()
}
await browser.close()

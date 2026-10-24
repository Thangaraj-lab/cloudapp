import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { networkInterfaces } from 'node:os'
import type { AddressInfo } from 'node:net'

// Adapters a phone on the same Wi-Fi can never reach.
const VIRTUAL = /docker|vbox|virtualbox|vmware|vethernet|wsl|hyper-v|tailscale|zerotier|utun|tun|tap|loopback|bridge|br-|veth|npcap|bluetooth/i

/** Non-internal IPv4 addresses, real Wi-Fi / Ethernet adapters first. */
export function lanAddresses(): string[] {
  const all: { name: string; ip: string }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) all.push({ name, ip: a.address })
  }
  const real = all.filter((a) => !VIRTUAL.test(a.name))
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3)
  return (real.length ? real : all).map((a) => a.ip).sort((x, y) => rank(x) - rank(y))
}

/** GET /__lan → { urls: ["http://192.168.x.x:5173"] }, GET /__ping → "ok". Dev and preview servers. */
function lanPlugin(): Plugin {
  const handler = (port: () => number) => (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }, next: () => void) => {
    const path = (req.url ?? '').split('?')[0]
    if (path === '/__ping') { res.setHeader('Content-Type', 'text/plain'); res.setHeader('Access-Control-Allow-Origin', '*'); res.end('ok'); return }
    if (path === '/__lan') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ urls: lanAddresses().map((ip) => `http://${ip}:${port()}`) }))
      return
    }
    next()
  }
  return {
    name: 'spendsentinel-lan',
    configureServer(server) {
      const port = () => (server.httpServer?.address() as AddressInfo | null)?.port ?? server.config.server.port ?? 5173
      server.middlewares.use(handler(port))
    },
    configurePreviewServer(server) {
      const port = () => (server.httpServer?.address() as AddressInfo | null)?.port ?? server.config.preview.port ?? 4173
      server.middlewares.use(handler(port))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), lanPlugin(),
    // Offline app: browsers only allow service workers on secure pages (https or localhost), so it
    // takes effect when the phone opens the app from its own edge node (http://localhost:8080).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'data/*.csv', 'data/*.json'],
      manifest: {
        name: 'SpendSentinel', short_name: 'SpendSentinel', start_url: '/#/m', scope: '/', display: 'standalone',
        theme_color: '#0C4137', background_color: '#051A16',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,woff,json,csv}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [{ urlPattern: /\/api\/dataset\.csv$/, handler: 'NetworkFirst', options: { cacheName: 'dataset', networkTimeoutSeconds: 3 } }],
      },
      devOptions: { enabled: false },
    })],
  // Listen on the LAN by default so a phone can open the app without --host.
  // /api goes to the FastAPI backend (engine, SQLite, local cloud, local LLM, edge node).
  server: { host: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, xfwd: true } } },
  preview: { host: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, xfwd: true } } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as never)

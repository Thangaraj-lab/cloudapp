import { useEffect, useState } from 'react'
import { getGPUTier } from 'detect-gpu'

export type Tier = 'high' | 'medium' | 'low' | 'none'

let cached: Promise<Tier> | null = null

export function webglOK(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** High: AO + bloom + DOF. Medium: no DOF. Low: no AO / bloom (phones). None: 2D fallback. */
export function detectTier(): Promise<Tier> {
  if (cached) return cached
  cached = (async () => {
    if (!webglOK()) return 'none'
    // Benchmarks are served from this app (public/benchmarks), never a CDN.
    const t = await getGPUTier({ benchmarksURL: `${import.meta.env.BASE_URL}benchmarks` }).catch(() => null)
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 640
    if (!t) return mobile ? 'low' : 'medium'
    if (t.tier >= 3 && !mobile) return 'high'
    if (t.tier >= 2) return mobile ? 'low' : 'medium'
    return 'low'
  })()
  return cached
}

export function useTier(): Tier | null {
  const [t, setT] = useState<Tier | null>(null)
  useEffect(() => { detectTier().then(setT) }, [])
  return t
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

import { StrictMode, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import './index.css'
import Shell, { ThemeSync } from './components/Shell'
import { Skeleton } from './components/ui'
import { useAutoVerify } from './flow/verify'
import { PhoneCrash } from './phone/PhoneCrash'
import { useBackendConnection } from './flow/backend'
import { useStore } from './store'

// Route-level code splitting keeps 3D and charts out of the first load.
const Welcome = lazy(() => import('./screens/first-run/Welcome'))
const Connect = lazy(() => import('./screens/first-run/Connect'))
const Check = lazy(() => import('./screens/first-run/Check'))
const Reveal = lazy(() => import('./screens/first-run/Reveal'))
const Overview = lazy(() => import('./screens/overview/Overview'))
const ServiceProfile = lazy(() => import('./screens/overview/Explore').then((m) => ({ default: m.ServiceProfile })))
const Trends = lazy(() => import('./screens/overview/Explore').then((m) => ({ default: m.Trends })))
const Ownership = lazy(() => import('./screens/overview/Explore').then((m) => ({ default: m.Ownership })))
const Inbox = lazy(() => import('./screens/cases/Inbox'))
const CaseFlow = lazy(() => import('./screens/cases/CaseFlow'))
const Waste = lazy(() => import('./screens/waste/Waste'))
const WasteDetail = lazy(() => import('./screens/waste/Waste').then((m) => ({ default: m.WasteDetail })))
const Proof = lazy(() => import('./screens/proof/Proof'))
const ReceiptView = lazy(() => import('./screens/proof/Proof').then((m) => ({ default: m.ReceiptView })))
const Guardrails = lazy(() => import('./screens/guardrails/Guardrails'))
const Backtest = lazy(() => import('./screens/guardrails/Guardrails').then((m) => ({ default: m.Backtest })))
const Settings = lazy(() => import('./screens/system/System').then((m) => ({ default: m.Settings })))
const Sources = lazy(() => import('./screens/system/System').then((m) => ({ default: m.Sources })))
const Edge = lazy(() => import('./screens/system/System').then((m) => ({ default: m.Edge })))
const phone = () => import('./phone/Phone')
const PhoneLayout = lazy(() => phone().then((m) => ({ default: m.PhoneLayout })))
const PhoneOverview = lazy(() => phone().then((m) => ({ default: m.PhoneOverview })))
const PhoneCases = lazy(() => phone().then((m) => ({ default: m.PhoneCases })))
const PhoneCase = lazy(() => phone().then((m) => ({ default: m.PhoneCase })))
const PhoneWaste = lazy(() => phone().then((m) => ({ default: m.PhoneWaste })))
const PhoneProof = lazy(() => phone().then((m) => ({ default: m.PhoneProof })))
const PhoneRules = lazy(() => phone().then((m) => ({ default: m.PhoneRules })))
const PhonePair = lazy(() => phone().then((m) => ({ default: m.PhonePair })))
const PhoneApprove = lazy(() => phone().then((m) => ({ default: m.PhoneApprove })))

const page = (el: ReactNode) => <Suspense fallback={<div className="space-y-4 p-6"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" /></div>}>{el}</Suspense>

function Background() {
  useAutoVerify()
  useBackendConnection()
  return null
}
/** Returning users land on the overview; first-time users on Welcome; phones on the phone app. */
function Home() {
  const hydrated = useStore((s) => s.hydrated)
  const rows = useStore((s) => s.rows.length)
  if (!hydrated) return null
  if (matchMedia('(max-width: 640px)').matches && matchMedia('(pointer: coarse)').matches) return <Navigate to="/m" replace />
  return <Navigate to={rows ? '/overview' : '/welcome'} replace />
}

const router = createHashRouter([
  { path: '/', element: <Home /> },
  { path: '/welcome', element: page(<Welcome />) },
  { path: '/connect', element: page(<Connect />) },
  { path: '/check', element: page(<Check />) },
  { path: '/reveal', element: page(<Reveal />) },
  {
    element: <Shell />,
    children: [
      { path: '/overview', element: page(<Overview />) },
      { path: '/service/:id', element: page(<ServiceProfile />) },
      { path: '/trends', element: page(<Trends />) },
      { path: '/ownership', element: page(<Ownership />) },
      { path: '/cases', element: page(<Inbox />) },
      { path: '/case/:id', element: page(<CaseFlow />) },
      { path: '/case/:id/:step', element: page(<CaseFlow />) },
      { path: '/waste', element: page(<Waste />) },
      { path: '/waste/:id', element: page(<WasteDetail />) },
      { path: '/proof', element: <Navigate to="/proof/savings" replace /> },
      { path: '/proof/receipt/:id', element: page(<ReceiptView />) },
      { path: '/proof/:tab', element: page(<Proof />) },
      { path: '/guardrails', element: page(<Guardrails />) },
      { path: '/guardrails/backtest', element: page(<Backtest />) },
      { path: '/settings', element: page(<Settings />) },
      { path: '/sources', element: page(<Sources />) },
      { path: '/edge', element: page(<Edge />) },
    ],
  },
  {
    path: '/m',
    element: page(<PhoneLayout />),
    errorElement: <PhoneCrash />,
    children: [
      { index: true, element: page(<PhoneOverview />) },
      { path: 'cases', element: page(<PhoneCases />) },
      { path: 'case/:id', element: page(<PhoneCase />) },
      { path: 'waste', element: page(<PhoneWaste />) },
      { path: 'proof', element: page(<PhoneProof />) },
      { path: 'rules', element: page(<PhoneRules />) },
      { path: 'pair/:code?', element: page(<PhonePair />) },
      { path: 'approve/:id', element: page(<PhoneApprove />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeSync />
    <Background />
    <RouterProvider router={router} />
  </StrictMode>,
)

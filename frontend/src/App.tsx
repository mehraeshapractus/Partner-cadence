import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import TrackerPage from './pages/TrackerPage'
import ReportPage from './pages/ReportPage'
import PartnerViewPage from './pages/PartnerViewPage'

export default function App() {
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const location = useLocation()
  const isPartnerView = location.pathname.startsWith('/partner/')

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await fetch('/api/sync', { method: 'POST' })
      const d = await r.json()
      setSyncMsg(`Synced ${d.partners_synced} partners · ${new Date(d.synced_at).toLocaleTimeString()}`)
      // dispatch a custom event so pages re-fetch
      window.dispatchEvent(new Event('practus:synced'))
    } catch {
      setSyncMsg('Sync failed — check backend')
    } finally {
      setSyncing(false)
    }
  }

  if (isPartnerView) return (
    <Routes>
      <Route path="/partner/:name" element={<PartnerViewPage />} />
    </Routes>
  )

  return (
    <>
      <div className="header">
        <h1>Practus Partner Action Tracker</h1>
        <div className="header-actions">
          <button className="btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync Read.ai'}
          </button>
          <button
            className="btn primary"
            onClick={() => window.dispatchEvent(new Event('practus:export'))}
          >
            Export ticked actions
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className={`sync-bar${syncMsg.includes('failed') ? ' error' : ''}`}>
          {syncMsg}
        </div>
      )}

      <nav className="page-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => 'page-tab' + (isActive ? ' active' : '')}
        >
          Partner Tracker
        </NavLink>
        <NavLink
          to="/report"
          className={({ isActive }) => 'page-tab' + (isActive ? ' active' : '')}
        >
          Partner Cadence Call Report
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<TrackerPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/partner/:name" element={<PartnerViewPage />} />
      </Routes>
    </>
  )
}

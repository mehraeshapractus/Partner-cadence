import { useEffect, useState, useCallback } from 'react'
import { Partner, LiveData } from '../types'

function parseDate(s: string): Date | null {
  if (!s || s === 'TBD' || s.toLowerCase().includes('recurring')) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function typeBadge(type: string) {
  const cls = type === 'BD Partner' ? 'r-bd' : type === 'Partner' ? 'r-pt' : 'r-sme'
  return <span className={`r-badge ${cls}`}>{type}</span>
}

export default function CadencePage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [liveData, setLiveData] = useState<Record<string, LiveData>>({})
  const [loading,  setLoading]  = useState(true)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [sbu,  setSbu]  = useState('')
  const [spoc, setSpoc] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch('/api/partners')
      const d = await r.json()
      setPartners(d.partners || [])
      setLiveData(d.live_data || {})
      setSyncedAt(d.synced_at)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    window.addEventListener('practus:synced', fetchData)
    return () => window.removeEventListener('practus:synced', fetchData)
  }, [fetchData])

  const INACTIVE_STAGES = new Set(['Dormant', 'Lost', 'Yet to be activated', ''])
  const OVERDUE_DAYS = 30

  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - OVERDUE_DAYS)

  const spocs = [...new Set(partners.map(p => p.spoc).filter(Boolean))].sort()

  const overdue = partners
    .filter(p => !INACTIVE_STAGES.has(p.stage || ''))
    .filter(p => {
      const ld = liveData[p.name]
      const lm = ld?.last_meeting || p.last_meeting
      const d  = parseDate(lm)
      // No meeting date recorded, OR last meeting was over OVERDUE_DAYS ago
      return d === null || d < cutoff
    })
    .filter(p => !sbu  || (p.sbu || 'Unassigned') === sbu)
    .filter(p => !spoc || p.spoc === spoc)
    .sort((a, b) => {
      // Most overdue (oldest or no date) at the top
      const ad = parseDate(liveData[a.name]?.last_meeting || a.last_meeting)?.getTime() ?? 0
      const bd = parseDate(liveData[b.name]?.last_meeting || b.last_meeting)?.getTime() ?? 0
      return ad - bd
    })

  const todayStr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const noDate   = overdue.filter(p => !parseDate(liveData[p.name]?.last_meeting || p.last_meeting))
  const withDate = overdue.filter(p =>  parseDate(liveData[p.name]?.last_meeting || p.last_meeting))

  if (loading) return <div className="loading">Loading cadence data&#8230;</div>

  return (
    <>
      <div className="report-meta">
        <div className="rid">
          PRACTUS ADVISORS
          <span className="pipe">|</span> CADENCE EXCEPTION REPORT
          <span className="pipe">|</span> Active partners not spoken to in {OVERDUE_DAYS}+ days
          <span className="pipe">|</span> <span className="hi">{todayStr}</span>
        </div>
        <div className="src">
          <strong>Source:</strong> Read.ai sync
          {syncedAt && ` &#183; Last synced ${new Date(syncedAt).toLocaleTimeString()}`}
        </div>
      </div>

      <div className="controls">
        <div className="control-group">
          <label>SBU</label>
          <select value={sbu} onChange={e => setSbu(e.target.value)}>
            <option value="">All</option>
            {['US', 'India', 'MEA', 'Global', 'Unassigned'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>Practus SPOC</label>
          <select value={spoc} onChange={e => setSpoc(e.target.value)}>
            <option value="">All</option>
            {spocs.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="summary-bar">
        <div className="stat accent">
          <div className="num">{overdue.length}</div>
          <div className="lbl">Overdue partners</div>
        </div>
        <div className="stat">
          <div className="num">{noDate.length}</div>
          <div className="lbl">Never recorded</div>
        </div>
        <div className="stat">
          <div className="num">{withDate.length}</div>
          <div className="lbl">Call on record but overdue</div>
        </div>
      </div>

      {overdue.length === 0 ? (
        <div className="empty">All active partners have been contacted in the last {OVERDUE_DAYS} days.</div>
      ) : (
        <div className="report-tbl-wrap">
          <table className="report-tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th style={{ minWidth: 130 }}>Partner</th>
                <th style={{ minWidth: 100 }}>Partner Contact</th>
                <th style={{ minWidth: 110 }}>Practus SPOC</th>
                <th style={{ minWidth: 70 }}>SBU</th>
                <th style={{ minWidth: 80 }}>Type</th>
                <th style={{ minWidth: 95 }}>Last Meeting</th>
                <th style={{ minWidth: 70, textAlign: 'center' }}>Days Ago</th>
                <th style={{ minWidth: 110 }}>Read.ai Report</th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((p, i) => {
                const ld       = liveData[p.name]
                const lm       = ld?.last_meeting || p.last_meeting
                const d        = parseDate(lm)
                const daysAgo  = d ? Math.floor((today.getTime() - d.getTime()) / 86400000) : null
                const reportUrl = ld?.report_url || ''
                const contact  = p.partner_spoc || ''

                return (
                  <tr key={p.name}>
                    <td style={{ textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5 }}>{i + 1}</td>
                    <td><strong style={{ color: 'var(--hdr)', fontSize: 12 }}>{p.name}</strong></td>
                    <td style={{ fontSize: 11 }}>{contact || <span className="r-nd">&#8212;</span>}</td>
                    <td style={{ fontSize: 11 }}>{p.spoc || <span className="r-nd">&#8212;</span>}</td>
                    <td><span className="sbu-tag">{p.sbu || 'Unassigned'}</span></td>
                    <td>{typeBadge(p.type)}</td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{lm || <span className="r-nd" style={{ color: '#ef4444' }}>No meeting on record</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {daysAgo !== null
                        ? <span className={`r-badge ${daysAgo > 60 ? 'r-bd' : 'r-exploring'}`}>{daysAgo}d</span>
                        : <span className="r-nd">&#8212;</span>}
                    </td>
                    <td>
                      {reportUrl
                        ? <a
                            href={reportUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 10.5, color: 'var(--teal-d)', textDecoration: 'none', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '3px 8px', borderRadius: 3, whiteSpace: 'nowrap' }}
                          >
                            &#x1F4CB; Read.ai report
                          </a>
                        : <span className="r-nd">&#8212;</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="footnote">
        Active partners (GTM Active, Business Referred, Discussion Initiated) with no meeting in the last {OVERDUE_DAYS} days.
        Sorted by most overdue first. Generated: {todayStr}.
      </div>
    </>
  )
}

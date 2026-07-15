import { useEffect, useState, useCallback } from 'react'
import { ReportRow } from '../types'

function parseDate(s: string): Date | null {
  if (!s || s === 'TBD' || s.toLowerCase().includes('recurring')) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export default function ReportPage() {
  const [rows, setRows]         = useState<ReportRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [genAt, setGenAt]       = useState<string | null>(null)
  const [days, setDays]         = useState(0)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/report')
      const d = await r.json()
      setRows(d.rows || [])
      setSyncedAt(d.synced_at)
      setGenAt(d.generated_at)
    } catch { /* backend offline */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReport()
    window.addEventListener('practus:synced', fetchReport)
    return () => window.removeEventListener('practus:synced', fetchReport)
  }, [fetchReport])

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  function stageBadge(stage: string) {
    if (stage === 'GTM Active' || stage === 'Business Referred')
      return <span className="r-badge r-active">Active</span>
    if (stage === 'Discussion Initiated')
      return <span className="r-badge r-exploring">Exploring</span>
    return <span className="r-badge r-tbd">TBD</span>
  }

  function typeBadge(type: string) {
    const cls = type === 'BD Partner' ? 'r-bd' : type === 'Partner' ? 'r-pt' : 'r-sme'
    return <span className={`r-badge ${cls}`}>{type}</span>
  }

  if (loading) return <div className="loading">Building report…</div>

  let filtered = rows
  if (days > 0) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    filtered = rows.filter(row => {
      const lm = row.live_last_meeting || row.last_meeting
      const d  = parseDate(lm)
      return d !== null && d >= cutoff
    })
  }

  return (
    <>
      <div className="report-meta">
        <div className="rid">
          PRACTUS ADVISORS
          <span className="pipe">|</span> PARTNER TRACKER MASTER
          <span className="pipe">|</span> All Partners
          <span className="pipe">|</span> <span className="hi">{today}</span>
        </div>
      </div>

      <div className="call-banner">
        <span className="lbl">Partner Cadence Call</span>
        <span className="title">Most recent Partner Cadence Call — All Partners</span>
        <div className="right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ fontSize: 11, padding: '2px 6px', border: '1px solid #fde68a', borderRadius: 3, background: '#fffaf2', cursor: 'pointer' }}
          >
            <option value={0}>All time</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            As of {today}{syncedAt && ` · Synced ${new Date(syncedAt).toLocaleTimeString()}`}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ fontSize: 12 }}>
          {rows.length === 0
            ? 'No partner updates found. Run a sync or check that Partner Cadence calls are available.'
            : 'No partners had a meeting in this window.'}
        </div>
      ) : (
        <div className="report-tbl-wrap">
          <table className="report-tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th style={{ minWidth: 140 }}>Partner</th>
                <th style={{ minWidth: 110 }}>Contact</th>
                <th style={{ minWidth: 70 }}>Type</th>
                <th style={{ minWidth: 70 }}>SBU</th>
                <th style={{ minWidth: 70 }}>Status</th>
                <th style={{ minWidth: 90 }}>Last Meeting</th>
                <th style={{ minWidth: 200, maxWidth: 260 }}>Meeting Notes</th>
                <th style={{ minWidth: 220 }}>Open Actions</th>
                <th style={{ minWidth: 160 }}>Prospects in Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const lm      = row.live_last_meeting || row.last_meeting
                const notes   = row.live_notes || row.comments

                // Merge hardcoded + live + manual actions; deduplicate case-insensitively
                const hcAct  = row.actions || []
                const lvAct  = (row.live_actions || []).filter(
                  la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
                )
                const manAct = (row.manual_actions || []).filter(
                  ma => !hcAct.some(ha => ha.toLowerCase().trim() === ma.toLowerCase().trim())
                       && !lvAct.some(la => la.toLowerCase().trim() === ma.toLowerCase().trim())
                )
                const allAct = [...hcAct, ...lvAct, ...manAct]

                // Use actual prospects from manual_prospects (+ partner.prospects)
                const prospects = [
                  ...(row.prospects || []),
                  ...(row.manual_prospects || []).filter(
                    mp => !(row.prospects || []).includes(mp)
                  ),
                ]

                // Contact: show partner_spoc only if different from the partner name
                const contact = (row.partner_spoc && row.partner_spoc !== row.name)
                  ? row.partner_spoc
                  : '—'

                return (
                  <tr key={row.name}>
                    <td style={{ textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5 }}>{i + 1}</td>
                    <td><strong style={{ color: 'var(--hdr)', fontSize: 12 }}>{row.name}</strong></td>
                    <td style={{ fontSize: 11.5, color: '#374151' }}>{contact}</td>
                    <td>{typeBadge(row.type)}</td>
                    <td style={{ fontSize: 11, color: '#6b7280' }}>{row.sbu || '—'}</td>
                    <td>{stageBadge(row.stage)}</td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{lm || <span className="r-nd">—</span>}</td>
                    <td style={{ fontSize: 11 }}>
                      {notes || <span className="r-nd">—</span>}
                    </td>
                    <td>
                      {allAct.length > 0
                        ? <ul className="actions-list">
                            {allAct.map((a, ai) => (
                              <li key={ai} style={{ fontSize: 11 }}>
                                <span>{a}</span>
                                {ai >= hcAct.length && ai < hcAct.length + lvAct.length && (
                                  <span className="live-badge">live</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        : <span className="r-nd">—</span>}
                    </td>
                    <td>
                      {prospects.length > 0
                        ? prospects.map((pr, pi) => (
                            <span key={pi} style={{ display: 'block', fontSize: 10.5, color: 'var(--teal-d)', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '2px 6px', borderRadius: 3, marginBottom: 3 }}>
                              {pr}
                            </span>
                          ))
                        : <span className="r-nd">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="footnote">
        Includes partners with any recorded meeting, action, or prospect. Generated: {genAt ? new Date(genAt).toLocaleString() : today}.
      </div>
    </>
  )
}

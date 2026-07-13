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

  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - 14)

  const spocs = [...new Set(partners.map(p => p.spoc).filter(Boolean))].sort()

  const recent = partners
    .filter(p => {
      const ld = liveData[p.name]
      const lm = ld?.last_meeting || p.last_meeting
      const d  = parseDate(lm)
      return d !== null && d >= cutoff
    })
    .filter(p => !sbu  || (p.sbu || 'Unassigned') === sbu)
    .filter(p => !spoc || p.spoc === spoc)
    .sort((a, b) => {
      const ad = parseDate(liveData[a.name]?.last_meeting || a.last_meeting)?.getTime() ?? 0
      const bd = parseDate(liveData[b.name]?.last_meeting || b.last_meeting)?.getTime() ?? 0
      return bd - ad
    })

  const todayStr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  if (loading) return <div className="loading">Loading cadence data&#8230;</div>

  return (
    <>
      <div className="report-meta">
        <div className="rid">
          PRACTUS ADVISORS
          <span className="pipe">|</span> CADENCE EXCEPTION REPORT
          <span className="pipe">|</span> Partners with calls in last 14 days
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
          <div className="num">{recent.length}</div>
          <div className="lbl">Partners with recent call</div>
        </div>
        <div className="stat">
          <div className="num">{recent.filter(p => {
            const d = parseDate(liveData[p.name]?.last_meeting || p.last_meeting)
            return d && (today.getTime() - d.getTime()) / 86400000 <= 7
          }).length}</div>
          <div className="lbl">Called this week</div>
        </div>
        <div className="stat">
          <div className="num">{recent.filter(p => liveData[p.name]?.report_url).length}</div>
          <div className="lbl">With Read.ai report</div>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="empty">
          No partner cadence calls found in the last 14 days.
          {!syncedAt && ' Run a sync to pull Read.ai meeting data.'}
        </div>
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
                <th style={{ minWidth: 200, maxWidth: 260 }}>Meeting Notes</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p, i) => {
                const ld       = liveData[p.name]
                const lm       = ld?.last_meeting || p.last_meeting
                const d        = parseDate(lm)
                const daysAgo  = d ? Math.floor((today.getTime() - d.getTime()) / 86400000) : null
                const reportUrl = ld?.report_url || ''
                const notes    = ld?.notes || p.comments || ''
                const contact  = p.partner_spoc || ''

                return (
                  <tr key={p.name}>
                    <td style={{ textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5 }}>{i + 1}</td>
                    <td><strong style={{ color: 'var(--hdr)', fontSize: 12 }}>{p.name}</strong></td>
                    <td style={{ fontSize: 11 }}>{contact || <span className="r-nd">&#8212;</span>}</td>
                    <td style={{ fontSize: 11 }}>{p.spoc || <span className="r-nd">&#8212;</span>}</td>
                    <td><span className="sbu-tag">{p.sbu || 'Unassigned'}</span></td>
                    <td>{typeBadge(p.type)}</td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{lm || <span className="r-nd">&#8212;</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {daysAgo !== null
                        ? <span className={`r-badge ${daysAgo <= 7 ? 'r-active' : 'r-exploring'}`}>{daysAgo}d</span>
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
                        : <span className="r-nd">No report yet</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {notes
                        ? <span style={{ whiteSpace: 'pre-line' }}>{notes.split('\n\n')[0]}</span>
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
        Partners where Read.ai last_meeting date falls within the last 14 days.
        Only partner cadence, alignment, and planning calls are tracked.
        Generated: {todayStr}.
      </div>
    </>
  )
}

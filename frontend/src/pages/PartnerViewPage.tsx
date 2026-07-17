import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Partner, LiveData } from '../types'
import { fnvHash } from './TrackerPage'

const LS_KEY = 'practus-tracker-ticks-v2'

function parseDate(s: string): Date | null {
  if (!s || s === 'TBD' || s.toLowerCase().includes('recurring')) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysAgo(s: string): number | null {
  const d = parseDate(s)
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export default function PartnerViewPage() {
  const { name } = useParams<{ name: string }>()
  const [partner,       setPartner]       = useState<Partner | null>(null)
  const [liveData,      setLiveData]      = useState<LiveData | null>(null)
  const [manualActions, setManualActions] = useState<string[]>([])
  const [loading,       setLoading]       = useState(true)
  const [copied,        setCopied]        = useState(false)
  const [actionStates,  setActionStates]  = useState<Record<string, string>>({})

  const decodedName = name ? decodeURIComponent(name) : ''

  function aKey(text: string) { return text.trim().slice(0, 60) }

  useEffect(() => {
    async function load() {
      try {
        const [pr, mr, sr] = await Promise.all([
          fetch('/api/partners'),
          fetch('/api/manual-actions'),
          fetch(`/api/action-states/${encodeURIComponent(decodedName)}`),
        ])
        const pd = await pr.json()
        const md = await mr.json()
        const sd = await sr.json()
        const p = (pd.partners as Partner[]).find(
          x => x.name.toLowerCase() === decodedName.toLowerCase()
        )
        if (!p) { setLoading(false); return }

        const ldData = pd.live_data?.[p.name] || { notes: '', actions: [], last_meeting: '' }
        const mnActs = (md.manual_actions?.[p.name] || []) as string[]
        const hcActs = p.actions || []
        const lvActs = (ldData.actions || []).filter(
          (la: string) => !hcActs.some((ha: string) => ha.toLowerCase().trim() === la.toLowerCase().trim())
        )

        // Merge backend action_states with localStorage ticks from the main table
        const backendStates: Record<string, string> = sd.states || {}
        const ticks: Record<string, { at: string }> = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
        const merged = { ...backendStates }
        hcActs.forEach((a: string, i: number) => {
          if (ticks[`${p.name}::${i}`]) merged[aKey(a)] = 'done'
        })
        lvActs.forEach((a: string) => {
          if (ticks[`live::${p.name}::${fnvHash(a.trim())}`]) merged[aKey(a)] = 'done'
        })
        mnActs.forEach((a: string) => {
          if (ticks[`manual::${p.name}::${fnvHash(a.trim())}`]) merged[aKey(a)] = 'done'
        })

        setPartner(p)
        setLiveData(ldData)
        setManualActions(mnActs)
        setActionStates(merged)
      } catch { } finally { setLoading(false) }
    }
    load()
  }, [decodedName])

  async function toggleDone(text: string) {
    const key = aKey(text)
    const next = actionStates[key] === 'done' ? 'open' : 'done'
    setActionStates(prev => ({ ...prev, [key]: next }))
    await fetch('/api/action-states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: partner!.name, key, state: next }),
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontSize: 14, color: '#6b7280' }}>
      Loading…
    </div>
  )

  if (!partner) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 15, color: '#6b7280' }}>Partner "{decodedName}" not found.</div>
    </div>
  )

  const lm      = liveData?.last_meeting || partner.last_meeting
  const da      = daysAgo(lm)
  const notes   = liveData?.notes
    ? liveData.notes + (partner.comments ? '\n\n' + partner.comments : '')
    : partner.comments
  const hcAct   = partner.actions || []
  const lvAct   = (liveData?.actions || []).filter(
    la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
  )
  const mnAct   = manualActions.filter(
    ma => !hcAct.some(ha => ha.toLowerCase().trim() === ma.toLowerCase().trim()) &&
          !lvAct.some(la => la.toLowerCase().trim() === ma.toLowerCase().trim())
  )
  const allActions = [...hcAct, ...lvAct, ...mnAct]
  const prospects  = partner.prospects || []

  const openActs   = allActions.filter(a => actionStates[aKey(a)] !== 'done')
  const closedActs = allActions.filter(a => actionStates[aKey(a)] === 'done')

  const reportUrl  = liveData?.report_url || ''
  const today      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const typeColor  = partner.type === 'BD Partner' ? '#1d4ed8' : partner.type === 'Partner' ? '#0f766e' : '#7c3aed'
  const stageColor = partner.stage === 'GTM Active' ? '#b45309' : partner.stage === 'Business Referred' ? '#166534' : '#374151'
  const stageBg    = partner.stage === 'GTM Active' ? '#fef3c7' : partner.stage === 'Business Referred' ? '#dcfce7' : '#f3f4f6'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Top bar */}
      <div style={{ background: '#0f2d3d', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 3, height: 24, background: '#14b8a6', borderRadius: 2 }} />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: 0.3 }}>PRACTUS PARTNER TRACKER</span>
          <span style={{ color: '#64748b', fontSize: 12 }}>· Partner View</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleCopy}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: '1px solid #334155', background: copied ? '#14b8a6' : '#1e3a4a', color: '#fff', cursor: 'pointer', transition: 'background 0.15s' }}
          >
            {copied ? '✓ Copied link' : '⎘ Copy link'}
          </button>
          <button
            onClick={() => window.print()}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: '1px solid #334155', background: '#1e3a4a', color: '#fff', cursor: 'pointer' }}
          >
            ⎙ Print
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px' }}>

        {/* Partner header card */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '28px 32px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: typeColor, background: typeColor + '18', border: `1px solid ${typeColor}40`, borderRadius: 4, padding: '2px 9px', letterSpacing: 0.3 }}>
                  {partner.type.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: stageColor, background: stageBg, border: `1px solid ${stageColor}30`, borderRadius: 4, padding: '2px 9px' }}>
                  {partner.stage}
                </span>
                <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 9px' }}>
                  {partner.sbu || 'Unassigned'}
                </span>
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f2d3d', margin: 0, lineHeight: 1.2 }}>{partner.name}</h1>
              {partner.partner_spoc && partner.partner_spoc !== partner.name && (
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Contact: {partner.partner_spoc}</div>
              )}
              {partner.email && (
                <a href={`mailto:${partner.email}`} style={{ fontSize: 12.5, color: '#0f766e', marginTop: 4, display: 'block' }}>{partner.email}</a>
              )}
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>As of {today}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>SPOC: <strong style={{ color: '#374151' }}>{partner.spoc}</strong></div>
            </div>
          </div>

          {/* Meeting history / last meeting */}
          {(lm || (liveData?.meetings_history?.length ?? 0) > 0) && (
            <div style={{ marginTop: 18, padding: '14px 16px', background: '#f0fdfa', borderRadius: 6, border: '1px solid #99f6e4' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Meeting History {liveData?.meetings_history?.length ? `(${liveData.meetings_history.length})` : ''}
                </div>
                {da !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '4px 12px',
                    background: da <= 7 ? '#dcfce7' : da <= 21 ? '#fef3c7' : '#fee2e2',
                    color: da <= 7 ? '#166534' : da <= 21 ? '#92400e' : '#991b1b',
                    border: `1px solid ${da <= 7 ? '#86efac' : da <= 21 ? '#fde68a' : '#fca5a5'}`
                  }}>{da}d ago</span>
                )}
              </div>
              {liveData?.meetings_history && liveData.meetings_history.length > 0 ? (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {liveData.meetings_history.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: '#0f2d3d', minWidth: 90 }}>{m.date}</span>
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" title={m.title}
                          style={{ fontSize: 11, color: '#0f766e', background: '#fff', border: '1px solid #14b8a6', borderRadius: 4, padding: '3px 10px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          📋 Read.ai
                        </a>
                      ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{m.title || '—'}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#0f2d3d' }}>{lm}</div>
              )}
            </div>
          )}
        </div>

        {/* Open Actions */}
        {allActions.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '24px 32px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 }}>
              Open Actions <span style={{ fontWeight: 400, color: '#cbd5e1' }}>({openActs.length})</span>
            </div>
            {openActs.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {openActs.map((a) => {
                    return (
                      <tr key={a} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ width: 32, paddingTop: 10, paddingBottom: 10, verticalAlign: 'top' }}>
                          <svg
                            onClick={() => toggleDone(a)}
                            aria-label="Mark as done"
                            className="action-radio-open"
                            width="22" height="22" viewBox="0 0 22 22"
                            style={{ cursor: 'pointer', display: 'block', flexShrink: 0 }}
                          >
                            <circle cx="11" cy="11" r="8.5" fill="white" stroke="#475569" strokeWidth="2.5"/>
                          </svg>
                        </td>
                        <td style={{ fontSize: 13.5, color: '#1e293b', lineHeight: 1.65, padding: '10px 8px 10px 0', verticalAlign: 'top' }}>
                          {a}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>All actions marked as done.</div>
            )}

            {closedActs.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer', fontWeight: 600, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>▸</span> Closed ({closedActs.length})
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, opacity: 0.65 }}>
                  <tbody>
                    {closedActs.map((a) => (
                      <tr key={a} style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ width: 32, paddingTop: 8, paddingBottom: 8, verticalAlign: 'top' }}>
                          <svg
                            onClick={() => toggleDone(a)}
                            aria-label="Reopen action"
                            width="22" height="22" viewBox="0 0 22 22"
                            style={{ cursor: 'pointer', display: 'block' }}
                          >
                            <circle cx="11" cy="11" r="8.5" fill="#14b8a6" stroke="#14b8a6" strokeWidth="2.5"/>
                            <text x="11" y="15.5" textAnchor="middle" fontSize="11" fill="white" fontWeight="bold">✓</text>
                          </svg>
                        </td>
                        <td style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, padding: '8px 8px 8px 0', textDecoration: 'line-through', verticalAlign: 'top' }}>
                          {a}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

        {/* Prospects */}
        {prospects.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '24px 32px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 }}>
              Prospects / Pipeline <span style={{ fontWeight: 400, color: '#cbd5e1' }}>({prospects.length})</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                  <th style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left', paddingBottom: 8, width: 32 }}>#</th>
                  <th style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left', paddingBottom: 8 }}>Company / Contact</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map((pr, pi) => (
                  <tr key={pi} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ fontSize: 12, color: '#94a3b8', padding: '9px 8px 9px 0', verticalAlign: 'top' }}>{pi + 1}</td>
                    <td style={{ fontSize: 13.5, color: '#0f2d3d', fontWeight: 500, padding: '9px 0', verticalAlign: 'top' }}>{pr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Meeting notes */}
        {notes && (
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '24px 32px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 }}>Meeting Notes</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.75, whiteSpace: 'pre-line' }}>{notes}</div>
          </div>
        )}

        {allActions.length === 0 && !notes && prospects.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 10, padding: '40px 32px', textAlign: 'center', color: '#9ca3af', fontSize: 13, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            No meeting data yet — sync Read.ai to populate.
          </div>
        )}

        <div style={{ fontSize: 11, color: '#cbd5e1', textAlign: 'center', marginTop: 28 }}>
          Practus Advisors · Partner Tracker · Confidential
        </div>
      </div>

      <style>{`
        @media print {
          body { background: #fff !important; }
          button { display: none !important; }
        }
        .action-radio-open circle { transition: stroke 0.15s; }
        .action-radio-open:hover circle { stroke: #14b8a6; }
        .action-radio-open:hover { filter: drop-shadow(0 0 3px rgba(20,184,166,0.35)); }
      `}</style>
    </div>
  )
}

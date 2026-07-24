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
  const [partner,        setPartner]        = useState<Partner | null>(null)
  const [liveData,       setLiveData]       = useState<LiveData | null>(null)
  const [manualActions,  setManualActions]  = useState<string[]>([])
  const [loading,        setLoading]        = useState(true)
  const [copied,         setCopied]         = useState(false)
  const [actionStates,   setActionStates]   = useState<Record<string, string>>({})
  const [practusTokens,  setPractusTokens]  = useState<string[]>(['practus'])
  const [manualMeetings, setManualMeetings] = useState<Array<{date: string; url: string; title: string}>>([])
  const [addingMeeting,  setAddingMeeting]  = useState(false)
  const [meetingDate,    setMeetingDate]    = useState('')
  const [meetingUrl,      setMeetingUrl]      = useState('')
  const [meetingSaving,   setMeetingSaving]   = useState(false)
  const [prospectStages,  setProspectStages]  = useState<Record<string, string>>({})

  const decodedName = name ? decodeURIComponent(name) : ''

  function aKey(text: string) { return text.trim().slice(0, 60) }

  useEffect(() => {
    async function load() {
      try {
        const [pr, mr, sr, mmr, psr] = await Promise.all([
          fetch('/api/partners'),
          fetch('/api/manual-actions'),
          fetch(`/api/action-states/${encodeURIComponent(decodedName)}`),
          fetch(`/api/manual-meetings/${encodeURIComponent(decodedName)}`),
          fetch(`/api/prospect-stages/${encodeURIComponent(decodedName)}`),
        ])
        const pd  = await pr.json()
        const md  = await mr.json()
        const sd  = await sr.json()
        const mmd = await mmr.json()
        const psd = await psr.json()
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

        const allTokens = new Set<string>(['practus'])
        ;(pd.partners as Partner[]).forEach((px: Partner) => {
          if (!px.spoc) return
          px.spoc.replace(/[^a-zA-Z]/g, ' ').split(/\s+/)
            .flatMap(t => (t.match(/[A-Z][a-z]+|[A-Z]+(?=[A-Z])|[a-z]+/g) || [t]))
            .filter(t => t.length >= 4)
            .forEach(t => allTokens.add(t.toLowerCase()))
        })
        setPractusTokens([...allTokens])

        setPartner(p)
        setLiveData(ldData)
        setManualActions(mnActs)
        setActionStates(merged)
        setManualMeetings(mmd.meetings || [])
        setProspectStages(psd.stages || {})
      } catch { } finally { setLoading(false) }
    }
    load()
  }, [decodedName])

  async function deleteAction(text: string) {
    if (!partner) return
    const idx = manualActions.indexOf(text)
    if (idx !== -1) {
      await fetch(`/api/manual-actions/${encodeURIComponent(partner.name)}/${idx}`, { method: 'DELETE' })
      setManualActions(prev => prev.filter((_, i) => i !== idx))
    } else {
      await toggleDone(text)
    }
  }

  async function toggleDone(text: string) {
    const key  = aKey(text)
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

  async function addMeeting() {
    if (!meetingDate || !partner) return
    setMeetingSaving(true)
    try {
      const res = await fetch(`/api/manual-meetings/${encodeURIComponent(partner.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: meetingDate, url: meetingUrl.trim(), title: '' }),
      })
      const d = await res.json()
      if (d.ok) {
        setManualMeetings(d.meetings || [])
        setAddingMeeting(false)
        setMeetingDate('')
        setMeetingUrl('')
      }
    } finally { setMeetingSaving(false) }
  }

  async function deleteMeeting(index: number) {
    if (!partner) return
    const res = await fetch(`/api/manual-meetings/${encodeURIComponent(partner.name)}/${index}`, { method: 'DELETE' })
    const d   = await res.json()
    if (d.ok) setManualMeetings(prev => prev.filter((_, i) => i !== index))
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

  const lm    = liveData?.last_meeting || partner.last_meeting
  const da    = daysAgo(lm)
  const notes = liveData?.notes
    ? liveData.notes + (partner.comments ? '\n\n' + partner.comments : '')
    : partner.comments
  const hcAct = partner.actions || []
  const lvAct = (liveData?.actions || []).filter(
    la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
  )
  const mnAct = manualActions.filter(
    ma => !hcAct.some(ha => ha.toLowerCase().trim() === ma.toLowerCase().trim()) &&
          !lvAct.some(la => la.toLowerCase().trim() === ma.toLowerCase().trim())
  )
  const allActions = [...hcAct, ...lvAct, ...mnAct]
  const prospects  = partner.prospects || []

  const openActs   = allActions.filter(a => actionStates[aKey(a)] !== 'done')
  const closedActs = allActions.filter(a => actionStates[aKey(a)] === 'done')

  function classifyAction(text: string): 'practus' | 'partner' {
    const firstWord = text.toLowerCase().trim().split(/\s+/)[0]
    return practusTokens.some(t => firstWord === t || firstWord.startsWith(t) || t.startsWith(firstWord))
      ? 'practus'
      : 'partner'
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const syncedMeetings = (liveData?.meetings_history || []).filter(m => !m.manual)
  const manualDates    = new Set(manualMeetings.map(m => m.date))
  const allMeetings    = [
    ...syncedMeetings.filter(m => !manualDates.has(m.date)),
    ...manualMeetings.map(m => ({ ...m, manual: true as const })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const typeColor  = partner.type === 'BD Partner' ? '#1d4ed8' : partner.type === 'Partner' ? '#0f766e' : '#7c3aed'
  const stageColor = partner.stage === 'GTM Active' ? '#b45309' : partner.stage === 'Business Referred' ? '#166534' : '#374151'
  const stageBg    = partner.stage === 'GTM Active' ? '#fef3c7' : partner.stage === 'Business Referred' ? '#dcfce7' : '#f3f4f6'

  async function updateProspectStage(prospect: string, stage: string) {
    if (!partner) return
    setProspectStages(prev => ({ ...prev, [prospect]: stage }))
    await fetch('/api/prospect-stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: partner.name, prospect, stage }),
    })
  }

  function buildUpdateEmailHref() {
    if (!partner || !partner.email) return ''
    const partnerActs = openActs.filter(a => classifyAction(a) === 'partner')
    const practusActs = openActs.filter(a => classifyAction(a) === 'practus')
    let body = `Hi ${partner.partner_spoc || partner.name},\n\nFollowing up on our partnership — here is a quick update on pending items:\n`
    if (partnerActs.length > 0)
      body += `\nPending from your side:\n${partnerActs.map(a => `• ${a}`).join('\n')}`
    if (practusActs.length > 0)
      body += `\n\nPending from Practus:\n${practusActs.map(a => `• ${a}`).join('\n')}`
    if (prospects.length > 0)
      body += `\n\nShared pipeline:\n${prospects.map(pr => `• ${pr}`).join('\n')}`
    body += `\n\nLooking forward to our continued collaboration.\n\nBest regards,\nPractus Team`
    return `mailto:${partner.email}?subject=${encodeURIComponent(`Partnership Update — ${partner.name}`)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Top bar */}
      <div style={{ background: '#0f2d3d', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 3, height: 24, background: '#14b8a6', borderRadius: 2 }} />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: 0.3 }}>PRACTUS PARTNER TRACKER</span>
          <span style={{ color: '#64748b', fontSize: 12 }}>· Partner View</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {partner.email && (
            <a
              href={`mailto:${partner.email}`}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: '1px solid #334155', background: '#1e3a4a', color: '#fff', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              ✉ Email
            </a>
          )}
          {partner.email && openActs.length > 0 && (
            <a
              href={buildUpdateEmailHref()}
              title="Draft a follow-up email with open action items"
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: '1px solid #334155', background: '#1e3a4a', color: '#fff', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              ↻ Send Update
            </a>
          )}
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
              <div style={{ marginTop: 10 }}>
                {partner.email ? (
                  <a
                    href={`mailto:${partner.email}`}
                    style={{ fontSize: 12.5, padding: '6px 16px', borderRadius: 5, background: '#0f766e', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
                  >
                    ✉ Email {partner.partner_spoc || partner.name}
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No email on record</span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>As of {today}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>SPOC: <strong style={{ color: '#374151' }}>{partner.spoc}</strong></div>
            </div>
          </div>

          {/* Meeting History */}
          <div style={{ marginTop: 18, padding: '14px 16px', background: '#f0fdfa', borderRadius: 6, border: '1px solid #99f6e4' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Meeting History {allMeetings.length > 0 ? `(${allMeetings.length})` : ''}
                </span>
                {da !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '3px 10px',
                    background: da <= 7 ? '#dcfce7' : da <= 21 ? '#fef3c7' : '#fee2e2',
                    color: da <= 7 ? '#166534' : da <= 21 ? '#92400e' : '#991b1b',
                    border: `1px solid ${da <= 7 ? '#86efac' : da <= 21 ? '#fde68a' : '#fca5a5'}`
                  }}>{da}d ago</span>
                )}
              </div>
              {!addingMeeting && (
                <button
                  onClick={() => setAddingMeeting(true)}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid #14b8a6', background: '#fff', color: '#0f766e', cursor: 'pointer', fontWeight: 600 }}
                >
                  + Add meeting
                </button>
              )}
            </div>

            {allMeetings.length > 0 ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allMeetings.map((m, i) => {
                  const manualIdx = m.manual
                    ? manualMeetings.findIndex(mm => mm.date === m.date && mm.url === m.url)
                    : -1
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: '#0f2d3d', minWidth: 92, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{m.date}</span>
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" title={m.title}
                          style={{ fontSize: 11, color: '#0f766e', background: '#fff', border: '1px solid #14b8a6', borderRadius: 4, padding: '3px 10px', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          📋 Read.ai
                        </a>
                      ) : (
                        <span style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.title || '—'}</span>
                      )}
                      {m.manual && manualIdx >= 0 && (
                        <button
                          onClick={() => deleteMeeting(manualIdx)}
                          title="Remove this entry"
                          style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px', lineHeight: 1, flexShrink: 0 }}
                        >✕</button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                No meetings recorded yet.
              </div>
            )}

            {addingMeeting && (
              <div style={{ marginTop: 12, padding: '12px 14px', background: '#fff', borderRadius: 6, border: '1px solid #b2f5ea', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>Date</label>
                  <input
                    type="date"
                    value={meetingDate}
                    onChange={e => setMeetingDate(e.target.value)}
                    style={{ fontSize: 13, padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e1', color: '#0f2d3d', outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>Read.ai link (optional)</label>
                  <input
                    type="url"
                    value={meetingUrl}
                    onChange={e => setMeetingUrl(e.target.value)}
                    placeholder="https://app.read.ai/analytics/meetings/..."
                    style={{ fontSize: 12, padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e1', color: '#0f2d3d', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={addMeeting}
                    disabled={!meetingDate || meetingSaving}
                    style={{ fontSize: 12, padding: '6px 16px', borderRadius: 4, border: 'none', background: meetingDate ? '#0f766e' : '#cbd5e1', color: '#fff', cursor: meetingDate ? 'pointer' : 'default', fontWeight: 600 }}
                  >
                    {meetingSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setAddingMeeting(false); setMeetingDate(''); setMeetingUrl('') }}
                    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 4, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Open Actions — split Partner vs Practus */}
        {allActions.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: '24px 32px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 16 }}>
              Open Actions <span style={{ fontWeight: 400, color: '#cbd5e1' }}>({openActs.length})</span>
            </div>

            {openActs.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ borderRight: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 16px', background: '#f0fdfa', borderBottom: '1px solid #e2e8f0' }}>
                    {partner.name}
                  </div>
                  {openActs.filter(a => classifyAction(a) === 'partner').length === 0
                    ? <div style={{ padding: '14px 16px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No open actions</div>
                    : openActs.filter(a => classifyAction(a) === 'partner').map(a => (
                      <div key={a} className="action-row" style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f8fafc', alignItems: 'flex-start' }}>
                        <svg onClick={() => toggleDone(a)} aria-label="Mark as done" className="action-radio-open"
                          width="20" height="20" viewBox="0 0 22 22" style={{ cursor: 'pointer', display: 'block', flexShrink: 0, marginTop: 2 }}>
                          <circle cx="11" cy="11" r="8.5" fill="white" stroke="#475569" strokeWidth="2.5"/>
                        </svg>
                        <span style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.6, flex: 1 }}>{a}</span>
                        <button onClick={() => deleteAction(a)} className="action-delete-btn" title="Remove action" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', flexShrink: 0, marginTop: 2, borderRadius: 3 }}>✕</button>
                      </div>
                    ))
                  }
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 16px', background: '#eff6ff', borderBottom: '1px solid #e2e8f0' }}>
                    Practus
                  </div>
                  {openActs.filter(a => classifyAction(a) === 'practus').length === 0
                    ? <div style={{ padding: '14px 16px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No open actions</div>
                    : openActs.filter(a => classifyAction(a) === 'practus').map(a => (
                      <div key={a} className="action-row" style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f8fafc', alignItems: 'flex-start' }}>
                        <svg onClick={() => toggleDone(a)} aria-label="Mark as done" className="action-radio-open"
                          width="20" height="20" viewBox="0 0 22 22" style={{ cursor: 'pointer', display: 'block', flexShrink: 0, marginTop: 2 }}>
                          <circle cx="11" cy="11" r="8.5" fill="white" stroke="#1d4ed8" strokeWidth="2.5"/>
                        </svg>
                        <span style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.6, flex: 1 }}>{a}</span>
                        <button onClick={() => deleteAction(a)} className="action-delete-btn" title="Remove action" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', flexShrink: 0, marginTop: 2, borderRadius: 3 }}>✕</button>
                      </div>
                    ))
                  }
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>All actions marked as done.</div>
            )}

            {closedActs.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer', fontWeight: 600, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>▸</span> Closed ({closedActs.length})
                </summary>
                <div style={{ marginTop: 8, border: '1px solid #f1f5f9', borderRadius: 8, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', opacity: 0.75 }}>
                  <div style={{ borderRight: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>{partner.name}</div>
                    {closedActs.filter(a => classifyAction(a) === 'partner').map(a => (
                      <div key={a} style={{ display: 'flex', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f8fafc', alignItems: 'flex-start' }}>
                        <svg onClick={() => toggleDone(a)} aria-label="Reopen action" width="20" height="20" viewBox="0 0 22 22" style={{ cursor: 'pointer', display: 'block', flexShrink: 0, marginTop: 2 }}>
                          <circle cx="11" cy="11" r="8.5" fill="#14b8a6" stroke="#14b8a6" strokeWidth="2.5"/>
                          <text x="11" y="15.5" textAnchor="middle" fontSize="11" fill="white" fontWeight="bold">✓</text>
                        </svg>
                        <span style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.55, textDecoration: 'line-through' }}>{a}</span>
                      </div>
                    ))}
                    {closedActs.filter(a => classifyAction(a) === 'partner').length === 0 && (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>None</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Practus</div>
                    {closedActs.filter(a => classifyAction(a) === 'practus').map(a => (
                      <div key={a} style={{ display: 'flex', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f8fafc', alignItems: 'flex-start' }}>
                        <svg onClick={() => toggleDone(a)} aria-label="Reopen action" width="20" height="20" viewBox="0 0 22 22" style={{ cursor: 'pointer', display: 'block', flexShrink: 0, marginTop: 2 }}>
                          <circle cx="11" cy="11" r="8.5" fill="#14b8a6" stroke="#14b8a6" strokeWidth="2.5"/>
                          <text x="11" y="15.5" textAnchor="middle" fontSize="11" fill="white" fontWeight="bold">✓</text>
                        </svg>
                        <span style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.55, textDecoration: 'line-through' }}>{a}</span>
                      </div>
                    ))}
                    {closedActs.filter(a => classifyAction(a) === 'practus').length === 0 && (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>None</div>
                    )}
                  </div>
                </div>
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                <thead>
                  <tr style={{ background: '#0f2d3d' }}>
                    <th style={{ fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'left', padding: '10px 10px 10px 12px', width: 36 }}>#</th>
                    <th style={{ fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'left', padding: '10px 10px' }}>Name of Prospect</th>
                    <th style={{ fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'left', padding: '10px 10px', width: 140 }}>Partner Reference</th>
                    <th style={{ fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'left', padding: '10px 12px 10px 10px', width: 200 }}>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((pr, pi) => {
                    const stage = prospectStages[pr] || ''
                    return (
                      <tr key={pi} style={{ borderBottom: '1px solid #f1f5f9', background: pi % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ fontSize: 12, color: '#94a3b8', padding: '10px 10px 10px 12px', fontVariantNumeric: 'tabular-nums' }}>{pi + 1}</td>
                        <td style={{ fontSize: 13, color: '#0f2d3d', fontWeight: 600, padding: '10px 10px' }}>{pr}</td>
                        <td style={{ fontSize: 12, color: '#475569', padding: '10px 10px' }}>{partner.name}</td>
                        <td style={{ padding: '8px 12px 8px 10px' }}>
                          <select
                            value={stage}
                            onChange={e => updateProspectStage(pr, e.target.value)}
                            style={{
                              fontSize: 11.5, padding: '4px 8px', borderRadius: 4,
                              border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151',
                              cursor: 'pointer', outline: 'none', width: '100%'
                            }}
                          >
                            <option value="">— Set stage —</option>
                            <option value="Need identification">Need identification</option>
                            <option value="Walk Through">Walk Through</option>
                            <option value="Deck to be sent">Deck to be sent</option>
                            <option value="QP">QP</option>
                            <option value="Intro Pending">Intro Pending</option>
                            <option value="Introduction Completed">Introduction Completed</option>
                            <option value="Meeting Scheduled">Meeting Scheduled</option>
                            <option value="Proposal Sent">Proposal Sent</option>
                            <option value="Pipeline">Pipeline</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
        .action-radio-open circle { transition: stroke 0.15s, fill 0.15s; }
        .action-radio-open:hover { filter: drop-shadow(0 0 3px rgba(20,184,166,0.35)); }
        .action-delete-btn { opacity: 0; transition: opacity 0.15s, color 0.15s; }
        .action-row:hover .action-delete-btn { opacity: 1; }
        .action-delete-btn:hover { color: #ef4444 !important; }
      `}</style>
    </div>
  )
}

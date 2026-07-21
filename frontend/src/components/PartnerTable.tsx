import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Partner, LiveData } from '../types'
import { fnvHash } from '../pages/TrackerPage'

interface Props {
  partners: Partner[]
  liveData: Record<string, LiveData>
  ticks: Record<string, { at: string }>
  onTick: (key: string, checked: boolean, partnerName: string, actionText: string) => void
  manualActions: Record<string, string[]>
  onAddAction: (partnerName: string, text: string) => void
  onDeleteAction: (partnerName: string, index: number) => void
  manualProspects: Record<string, string[]>
  onAddProspect: (partnerName: string, text: string) => void
  onDeleteProspect: (partnerName: string, index: number) => void
}

function typeClass(t: string) {
  return t === 'BD Partner' ? 'bd' : t === 'Partner' ? 'pt' : 'sme'
}
function stagePillClass(s: string) {
  return s === 'GTM Active' ? 'ga' : s === 'Business Referred' ? 'br' : 'di'
}
function stageClass(s: string) {
  return s === 'GTM Active' ? 'gtm' : s === 'Business Referred' ? 'br' : 'di'
}

interface DetailProps {
  p: Partner
  ld: LiveData
  ticks: Record<string, { at: string }>
  onTick: (key: string, checked: boolean, partnerName: string, actionText: string) => void
  manualActs: string[]
  onAddAction: (text: string) => void
  onDeleteAction: (index: number) => void
  onClose: () => void
}

function PartnerDetailModal({ p, ld, ticks, onTick, manualActs, onAddAction, onDeleteAction, onClose }: DetailProps) {
  const [adding, setAdding] = useState(false)
  const [draft,  setDraft]  = useState('')

  const lm        = ld.last_meeting || p.last_meeting
  const reportUrl = ld.report_url || ''
  const notesText = ld.notes
    ? ld.notes + (p.comments ? '\n\n' + p.comments : '')
    : p.comments
  const hcAct = p.actions || []
  const lvAct = (ld.actions || []).filter(
    la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
  )

  function submitDraft() {
    if (draft.trim()) { onAddAction(draft.trim()); setDraft('') }
    setAdding(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,44,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        style={{ width: 420, maxWidth: '95vw', height: '100vh', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', overflowY: 'auto', padding: '28px 28px 40px' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: 18, right: 20, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3)' }}>&#x2715;</button>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className={`type-pill ${typeClass(p.type)}`}>{p.type}</span>
            <span className={`stage-pill ${stagePillClass(p.stage)}`}>{p.stage}</span>
            <span className="sbu-tag">{p.sbu || 'Unassigned'}</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--hdr)' }}>{p.name}</div>
          {p.partner_spoc && p.partner_spoc !== p.name && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Contact: {p.partner_spoc}</div>
          )}
          {p.email && (
            <div style={{ marginTop: 4 }}>
              <a href={`mailto:${p.email}`} style={{ fontSize: 11.5, color: 'var(--teal-d)' }}>{p.email}</a>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 24, fontSize: 11.5, color: 'var(--text-3)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '10px 0', marginBottom: 18 }}>
          <div><span style={{ fontWeight: 600 }}>SPOC</span><br />{p.spoc || '—'}</div>
          {p.willingness && <div><span style={{ fontWeight: 600 }}>Willingness</span><br />{p.willingness}</div>}
          {p.intro_quality && <div><span style={{ fontWeight: 600 }}>Intro quality</span><br />{p.intro_quality}</div>}
          <div><span style={{ fontWeight: 600 }}>Last meeting</span><br />{lm || '—'}</div>
        </div>

        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdfa', border: '1.5px solid #14b8a6', borderRadius: 6, padding: '10px 14px', marginBottom: 20, textDecoration: 'none', color: 'var(--teal-d)', fontWeight: 600, fontSize: 13 }}>
            <span style={{ fontSize: 18 }}>&#x1F4CB;</span>
            View Read.ai report
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>opens in new tab</span>
          </a>
        )}

        {notesText && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Meeting notes</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-line', background: 'var(--s)', padding: '10px 12px', borderRadius: 5 }}>{notesText}</div>
          </div>
        )}

        {(p.prospects || []).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Prospects / POV Decks</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(p.prospects || []).map((pr, pi) => (
                <span key={pi} style={{ fontSize: 11.5, background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: 4, padding: '3px 10px' }}>{pr}</span>
              ))}
            </div>
          </div>
        )}

        {/* Open actions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Open actions</div>
          <ul className="actions-list" style={{ paddingLeft: 0 }}>
            {hcAct.map((a, ai) => {
              const k = `${p.name}::${ai}`, done = !!ticks[k]
              return (
                <li key={k} className={done ? 'checked' : ''} style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} />
                  <span className="action-txt" style={{ fontSize: 12 }}>{a}</span>
                  {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                </li>
              )
            })}
            {lvAct.map((a) => {
              const k = `live::${p.name}::${fnvHash(a.trim())}`, done = !!ticks[k]
              return (
                <li key={k} className={done ? 'checked' : ''} style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} />
                  <span className="action-txt" style={{ fontSize: 12 }}>{a} <span className="live-badge">live</span></span>
                  {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                </li>
              )
            })}
            {manualActs.map((a, mi) => {
              const k = `manual::${p.name}::${fnvHash(a.trim())}`, done = !!ticks[k]
              return (
                <li key={k} className={done ? 'checked' : ''} style={{ marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} style={{ marginTop: 2 }} />
                  <span className="action-txt" style={{ fontSize: 12, flex: 1 }}>{a}</span>
                  {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                  <button onClick={() => onDeleteAction(mi)} title="Delete action"
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>
                    &times;
                  </button>
                </li>
              )
            })}
          </ul>

          {adding ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitDraft(); if (e.key === 'Escape') { setAdding(false); setDraft('') } }}
                placeholder="Type action and press Enter..."
                style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #14b8a6', borderRadius: 4, outline: 'none' }}
              />
              <button onClick={submitDraft} style={{ fontSize: 12, padding: '4px 10px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Add</button>
              <button onClick={() => { setAdding(false); setDraft('') }} style={{ fontSize: 12, padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              style={{ marginTop: 6, fontSize: 11.5, color: 'var(--teal-d)', background: 'none', border: '1px dashed #14b8a6', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              + Add action
            </button>
          )}
        </div>

        {!reportUrl && !notesText && hcAct.length === 0 && lvAct.length === 0 && manualActs.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic', marginTop: 12 }}>No meeting data yet — sync Read.ai to populate.</div>
        )}
      </div>
    </div>
  )
}

const PROSPECT_SHOW = 4

export default function PartnerTable({ partners, liveData, ticks, onTick, manualActions, onAddAction, onDeleteAction, manualProspects, onAddProspect, onDeleteProspect }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [addingProspectFor, setAddingProspectFor] = useState<string | null>(null)
  const [prospectDraft, setProspectDraft] = useState('')
  const [expandedProspects, setExpandedProspects] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  function toggleProspects(name: string) {
    setExpandedProspects(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const HEAD = ['#', 'Partner / Contact', 'SBU', 'Email', 'Type', 'Stage', 'Last Meeting', 'Open Actions (tick to mark done)', 'Prospects / POV Decks', 'Next Step + Flag', 'SPOC']

  const selectedPartner = selected ? partners.find(p => p.name === selected) : null
  const selectedLd      = selected ? (liveData[selected] || { notes: '', actions: [], last_meeting: '', report_url: '' }) : null

  function submitDraft(partnerName: string) {
    if (draft.trim()) { onAddAction(partnerName, draft.trim()); setDraft('') }
    setAddingFor(null)
  }

  return (
    <>
      {selectedPartner && selectedLd && (
        <PartnerDetailModal
          p={selectedPartner}
          ld={selectedLd}
          ticks={ticks}
          onTick={onTick}
          manualActs={manualActions[selectedPartner.name] || []}
          onAddAction={text => onAddAction(selectedPartner.name, text)}
          onDeleteAction={index => onDeleteAction(selectedPartner.name, index)}
          onClose={() => setSelected(null)}
        />
      )}

      <table className="tracker">
        <thead>
          <tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {partners.map((p, i) => {
            const ld       = liveData[p.name] || { notes: '', actions: [], last_meeting: '', report_url: '' }
            const notesText = ld.notes ? ld.notes + (p.comments ? ' — ' + p.comments : '') : p.comments
            const lm       = ld.last_meeting || p.last_meeting
            const reportUrl = ld.report_url || ''
            const email    = p.email || p.partner_spoc || ''
            const hcAct    = p.actions || []
            const lvAct    = (ld.actions || []).filter(la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim()))
            const mnAct    = manualActions[p.name] || []
            const isAdding = addingFor === p.name

            return (
              <tr key={p.name} className={stageClass(p.stage)}>
                <td style={{ color: 'var(--text-3)', fontWeight: 600, textAlign: 'center' }}>{i + 1}</td>
                <td>
                  <strong style={{ cursor: 'pointer', color: 'var(--teal-d)', textDecoration: 'underline dotted' }}
                    onClick={() => setSelected(p.name)} title="Click to view partner details">
                    {p.name}
                  </strong>
                  {(p.intro_quality || p.willingness) && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                      {p.intro_quality && `Intro: ${p.intro_quality}`}
                      {p.intro_quality && p.willingness && ' · '}
                      {p.willingness && `Willingness: ${p.willingness}`}
                    </div>
                  )}
                  {p.category && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{p.category}</div>}
                  <button onClick={e => { e.stopPropagation(); navigate('/partner/' + encodeURIComponent(p.name)) }}
                    style={{ marginTop: 5, fontSize: 10, padding: '2px 8px', borderRadius: 3, border: '1px solid #99f6e4', background: '#f0fdfa', color: '#0f766e', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    View ↗
                  </button>
                </td>
                <td><span className="sbu-tag">{p.sbu || 'Unassigned'}</span></td>
                <td style={{ fontSize: 10.5 }}>{email || <span className="placeholder">—</span>}</td>
                <td><span className={`type-pill ${typeClass(p.type)}`}>{p.type}</span></td>
                <td><span className={`stage-pill ${stagePillClass(p.stage)}`}>{p.stage}</span></td>
                <td style={{ fontSize: 10.5, minWidth: 110 }}>
                  {(() => {
                    const hist = ld.meetings_history
                    if (hist && hist.length > 0) {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {hist.map((m, mi) => (
                            <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 10, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{m.date}</span>
                              {m.url ? (
                                <a href={m.url} target="_blank" rel="noopener noreferrer" title={m.title}
                                  style={{ fontSize: 9.5, color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '1px 5px', borderRadius: 3, textDecoration: 'none', flexShrink: 0 }}>
                                  ↗
                                </a>
                              ) : (
                                <span style={{ fontSize: 9, color: '#94a3b8' }} title={m.title}>·</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    }
                    return lm ? <span style={{ fontSize: 10.5 }}>{lm}</span> : <span className="placeholder">—</span>
                  })()}
                </td>
                {/* Open Actions column */}
                <td style={{ minWidth: 260 }}>
                  {hcAct.length === 0 && lvAct.length === 0 && mnAct.length === 0 && !isAdding ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="placeholder">&mdash;</span>
                      <button onClick={() => { setAddingFor(p.name); setDraft('') }}
                        style={{ fontSize: 10, color: 'var(--teal-d)', background: 'none', border: '1px dashed #14b8a6', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        + Add
                      </button>
                    </div>
                  ) : (
                    <ul className="actions-list">
                      {hcAct.map((a, ai) => {
                        const k = `${p.name}::${ai}`, done = !!ticks[k]
                        return (
                          <li key={k} className={done ? 'checked' : ''}>
                            <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} />
                            <span className="action-txt">{a}</span>
                            {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                          </li>
                        )
                      })}
                      {lvAct.map((a) => {
                        const k = `live::${p.name}::${fnvHash(a.trim())}`, done = !!ticks[k]
                        return (
                          <li key={k} className={done ? 'checked' : ''}>
                            <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} />
                            <span className="action-txt">{a} <span className="live-badge">live</span></span>
                            {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                          </li>
                        )
                      })}
                      {mnAct.map((a, mi) => {
                        const k = `manual::${p.name}::${fnvHash(a.trim())}`, done = !!ticks[k]
                        return (
                          <li key={k} className={done ? 'checked' : ''} style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                            <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked, p.name, a)} style={{ marginTop: 2, flexShrink: 0 }} />
                            <span className="action-txt" style={{ flex: 1 }}>{a}</span>
                            {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                            <button onClick={() => onDeleteAction(p.name, mi)} title="Delete"
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13, padding: '0 1px', flexShrink: 0, lineHeight: 1 }}>
                              &times;
                            </button>
                          </li>
                        )
                      })}

                      {isAdding ? (
                        <li style={{ listStyle: 'none', marginTop: 4 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') submitDraft(p.name); if (e.key === 'Escape') { setAddingFor(null); setDraft('') } }}
                              placeholder="Type action..."
                              style={{ flex: 1, fontSize: 11, padding: '3px 6px', border: '1px solid #14b8a6', borderRadius: 3, outline: 'none' }} />
                            <button onClick={() => submitDraft(p.name)}
                              style={{ fontSize: 11, padding: '3px 8px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>+</button>
                            <button onClick={() => { setAddingFor(null); setDraft('') }}
                              style={{ fontSize: 11, padding: '3px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>✕</button>
                          </div>
                        </li>
                      ) : (
                        <li style={{ listStyle: 'none', marginTop: 3 }}>
                          <button onClick={() => { setAddingFor(p.name); setDraft('') }}
                            style={{ fontSize: 10, color: 'var(--teal-d)', background: 'none', border: '1px dashed #14b8a6', borderRadius: 3, padding: '2px 7px', cursor: 'pointer' }}>
                            + Add
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </td>

                <td style={{ minWidth: 160 }}>
                  {(() => {
                    const allProspects = p.prospects || []
                    const manualCount  = (manualProspects[p.name] || []).length
                    const isExpanded   = expandedProspects.has(p.name)
                    const visible      = isExpanded ? allProspects : allProspects.slice(0, PROSPECT_SHOW)
                    const hidden       = allProspects.length - PROSPECT_SHOW
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {visible.map((pr, pi) => {
                          const isManual = pi >= allProspects.length - manualCount
                          const manualIdx = pi - (allProspects.length - manualCount)
                          return (
                            <span key={pi} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ fontSize: 10.5, background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: 3, padding: '2px 7px', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }} title={pr}>{pr}</span>
                              {isManual && (
                                <button onClick={() => onDeleteProspect(p.name, manualIdx)} title="Remove"
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '0 1px', lineHeight: 1, flexShrink: 0 }}>&times;</button>
                              )}
                            </span>
                          )
                        })}
                        {allProspects.length > PROSPECT_SHOW && (
                          <button onClick={() => toggleProspects(p.name)}
                            style={{ fontSize: 10, color: '#0f766e', background: isExpanded ? '#f0fdfa' : 'none', border: '1px solid #99f6e4', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', alignSelf: 'flex-start', marginTop: 1 }}>
                            {isExpanded ? `▴ show less` : `▾ ${hidden} more`}
                          </button>
                        )}
                        {addingProspectFor === p.name ? (
                          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                            <input autoFocus value={prospectDraft} onChange={e => setProspectDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && prospectDraft.trim()) { onAddProspect(p.name, prospectDraft.trim()); setProspectDraft(''); setAddingProspectFor(null) }
                                if (e.key === 'Escape') { setAddingProspectFor(null); setProspectDraft('') }
                              }}
                              placeholder="Prospect name..."
                              style={{ flex: 1, fontSize: 10.5, padding: '2px 5px', border: '1px solid #99f6e4', borderRadius: 3, outline: 'none', minWidth: 0 }} />
                            <button onClick={() => { if (prospectDraft.trim()) { onAddProspect(p.name, prospectDraft.trim()); setProspectDraft(''); setAddingProspectFor(null) } }}
                              style={{ fontSize: 10, padding: '2px 6px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>+</button>
                            <button onClick={() => { setAddingProspectFor(null); setProspectDraft('') }}
                              style={{ fontSize: 10, padding: '2px 5px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={() => { setAddingProspectFor(p.name); setProspectDraft('') }}
                            style={{ fontSize: 10, color: '#0f766e', background: 'none', border: '1px dashed #99f6e4', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', alignSelf: 'flex-start' }}>
                            + Add
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </td>
                <td className="placeholder" style={{ fontStyle: 'italic', fontSize: 11 }}>(inferred)</td>
                <td><span className="spoc-pill">{p.spoc || '—'}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

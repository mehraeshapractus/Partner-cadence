import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Partner, LiveData } from '../types'
import { fnvHash } from '../pages/TrackerPage'

interface Props {
  partners: Partner[]
  liveData: Record<string, LiveData>
  ticks: Record<string, { at: string }>
  onTick: (key: string, checked: boolean) => void
}

function typeClass(t: string) {
  return t === 'BD Partner' ? 'bd' : t === 'Partner' ? 'pt' : 'sme'
}
function stageClass(s: string) {
  return s === 'GTM Active' ? 'gtm' : s === 'Business Referred' ? 'br' : 'di'
}
function stagePillClass(s: string) {
  return s === 'GTM Active' ? 'ga' : s === 'Business Referred' ? 'br' : 'di'
}

interface DetailProps {
  p: Partner
  ld: LiveData
  ticks: Record<string, { at: string }>
  onTick: (key: string, checked: boolean) => void
  onClose: () => void
}

function PartnerDetailModal({ p, ld, ticks, onTick, onClose }: DetailProps) {
  const lm        = ld.last_meeting || p.last_meeting
  const reportUrl = ld.report_url || ''
  const notesText = ld.notes
    ? ld.notes + (p.comments ? '\n\n' + p.comments : '')
    : p.comments
  const hcAct = p.actions || []
  const lvAct = (ld.actions || []).filter(
    la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,44,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        style={{ width: 420, maxWidth: '95vw', height: '100vh', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', overflowY: 'auto', padding: '28px 28px 40px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: 18, right: 20, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3)' }}>&#x2715;</button>

        {/* Header */}
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

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 24, fontSize: 11.5, color: 'var(--text-3)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '10px 0', marginBottom: 18 }}>
          <div><span style={{ fontWeight: 600 }}>SPOC</span><br />{p.spoc || '—'}</div>
          {p.willingness && <div><span style={{ fontWeight: 600 }}>Willingness</span><br />{p.willingness}</div>}
          {p.intro_quality && <div><span style={{ fontWeight: 600 }}>Intro quality</span><br />{p.intro_quality}</div>}
          <div><span style={{ fontWeight: 600 }}>Last meeting</span><br />{lm || '—'}</div>
        </div>

        {/* Read.ai report — prominent */}
        {reportUrl && (
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdfa', border: '1.5px solid #14b8a6', borderRadius: 6, padding: '10px 14px', marginBottom: 20, textDecoration: 'none', color: 'var(--teal-d)', fontWeight: 600, fontSize: 13 }}
          >
            <span style={{ fontSize: 18 }}>&#x1F4CB;</span>
            View Read.ai report
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>opens in new tab</span>
          </a>
        )}

        {/* Notes */}
        {notesText && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Meeting notes</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-line', background: 'var(--s)', padding: '10px 12px', borderRadius: 5 }}>{notesText}</div>
          </div>
        )}

        {/* Prospects */}
        {(p.prospects || []).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Prospects / POV Decks</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(p.prospects || []).map((pr, pi) => (
                <span key={pi} style={{ fontSize: 11.5, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a', borderRadius: 4, padding: '3px 10px' }}>{pr}</span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {(hcAct.length > 0 || lvAct.length > 0) && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Open actions</div>
            <ul className="actions-list" style={{ paddingLeft: 0 }}>
              {hcAct.map((a, ai) => {
                const k    = `${p.name}::${ai}`
                const done = !!ticks[k]
                return (
                  <li key={k} className={done ? 'checked' : ''} style={{ marginBottom: 6 }}>
                    <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked)} />
                    <span className="action-txt" style={{ fontSize: 12 }}>{a}</span>
                    {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                  </li>
                )
              })}
              {lvAct.map((a) => {
                const k    = `live::${p.name}::${fnvHash(a.trim())}`
                const done = !!ticks[k]
                return (
                  <li key={k} className={done ? 'checked' : ''} style={{ marginBottom: 6 }}>
                    <input type="checkbox" checked={done} onChange={e => onTick(k, e.target.checked)} />
                    <span className="action-txt" style={{ fontSize: 12 }}>{a} <span className="live-badge">live</span></span>
                    {done && <span className="done-badge">done {new Date(ticks[k].at).toLocaleDateString()}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!reportUrl && !notesText && hcAct.length === 0 && lvAct.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>No meeting data yet &#8212; sync Read.ai to populate.</div>
        )}
      </div>
    </div>
  )
}

export default function PartnerTable({ partners, liveData, ticks, onTick }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const navigate = useNavigate()

  const HEAD = ['#', 'Partner / Contact', 'SBU', 'Email', 'Type', 'Stage', 'Last Meeting', 'Meeting Notes & Key Updates', 'Open Actions (tick to mark done)', 'Prospects / POV Decks', 'Next Step + Flag', 'SPOC']

  const selectedPartner = selected ? partners.find(p => p.name === selected) : null
  const selectedLd      = selected ? (liveData[selected] || { notes: '', actions: [], last_meeting: '', report_url: '' }) : null

  return (
    <>
      {selectedPartner && selectedLd && (
        <PartnerDetailModal
          p={selectedPartner}
          ld={selectedLd}
          ticks={ticks}
          onTick={onTick}
          onClose={() => setSelected(null)}
        />
      )}

      <table className="tracker">
        <thead>
          <tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {partners.map((p, i) => {
            const ld      = liveData[p.name] || { notes: '', actions: [], last_meeting: '', report_url: '' }
            const notesText = ld.notes
              ? ld.notes + (p.comments ? ' — ' + p.comments : '')
              : p.comments
            const lm      = ld.last_meeting || p.last_meeting
            const reportUrl = ld.report_url || ''
            const email   = p.email || p.partner_spoc || ''
            const hcAct   = p.actions || []
            const lvAct   = (ld.actions || []).filter(
              la => !hcAct.some(ha => ha.toLowerCase().trim() === la.toLowerCase().trim())
            )

            return (
              <tr key={p.name} className={stageClass(p.stage)}>
                <td style={{ color: 'var(--text-3)', fontWeight: 600, textAlign: 'center' }}>{i + 1}</td>
                <td>
                  <strong
                    style={{ cursor: 'pointer', color: 'var(--teal-d)', textDecoration: 'underline dotted' }}
                    onClick={() => setSelected(p.name)}
                    title="Click to view partner details"
                  >
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
                  <button
                    onClick={e => { e.stopPropagation(); navigate('/partner/' + encodeURIComponent(p.name)) }}
                    style={{ marginTop: 5, fontSize: 10, padding: '2px 8px', borderRadius: 3, border: '1px solid #99f6e4', background: '#f0fdfa', color: '#0f766e', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    View ↗
                  </button>
                </td>
                <td><span className="sbu-tag">{p.sbu || 'Unassigned'}</span></td>
                <td style={{ fontSize: 10.5 }}>{email || <span className="placeholder">—</span>}</td>
                <td><span className={`type-pill ${typeClass(p.type)}`}>{p.type}</span></td>
                <td><span className={`stage-pill ${stagePillClass(p.stage)}`}>{p.stage}</span></td>
                <td style={{ fontSize: 10.5 }}>{lm || <span className="placeholder">—</span>}</td>
                <td style={{ maxWidth: 280, fontSize: 11 }}>
                  {notesText || <span className="placeholder">&mdash;</span>}
                  {reportUrl && (
                    <div style={{ marginTop: 4 }}>
                      <a href={reportUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: 'var(--teal-d)', textDecoration: 'none', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                        &#x1F4CB; Read.ai report
                      </a>
                    </div>
                  )}
                </td>
                <td style={{ minWidth: 260 }}>
                  {hcAct.length === 0 && lvAct.length === 0 ? (
                    <span className="placeholder">&mdash;</span>
                  ) : (
                    <ul className="actions-list">
                      {hcAct.map((a, ai) => {
                        const k    = `${p.name}::${ai}`
                        const done = !!ticks[k]
                        return (
                          <li key={k} className={done ? 'checked' : ''}>
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={e => onTick(k, e.target.checked)}
                            />
                            <span className="action-txt">{a}</span>
                            {done && (
                              <span className="done-badge">
                                done {new Date(ticks[k].at).toLocaleDateString()}
                              </span>
                            )}
                          </li>
                        )
                      })}
                      {lvAct.map((a) => {
                        const k    = `live::${p.name}::${fnvHash(a.trim())}`
                        const done = !!ticks[k]
                        return (
                          <li key={k} className={done ? 'checked' : ''}>
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={e => onTick(k, e.target.checked)}
                            />
                            <span className="action-txt">
                              {a} <span className="live-badge">live</span>
                            </span>
                            {done && (
                              <span className="done-badge">
                                done {new Date(ticks[k].at).toLocaleDateString()}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </td>
                <td style={{ minWidth: 160 }}>
                  {(p.prospects || []).length === 0
                    ? <span className="placeholder">&mdash;</span>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(p.prospects || []).map((pr, pi) => (
                          <span key={pi} style={{ fontSize: 10.5, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a', borderRadius: 3, padding: '2px 7px', display: 'inline-block', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={pr}>
                            {pr}
                          </span>
                        ))}
                      </div>
                  }
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

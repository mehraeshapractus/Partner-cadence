import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { WeekRow } from '../types'

const SBUS  = ['US', 'India', 'MEA', 'Global', 'Unassigned'] as const
const TYPES = ['BD Partner', 'Partner', 'SME'] as const

type SBU  = typeof SBUS[number]
type TYPE = typeof TYPES[number]

interface Popover {
  week: string
  type: TYPE
  sbu: SBU
  partners: string[]
  x: number
  y: number
}

export default function WeeklyMatrix({ weekly }: { weekly: WeekRow[] }) {
  const navigate = useNavigate()
  const [popover, setPopover] = useState<Popover | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setPopover(null)
      }
    }
    if (popover) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [popover])

  function handleCellClick(
    e: React.MouseEvent,
    w: WeekRow,
    t: TYPE,
    s: SBU,
    n: number,
  ) {
    if (n === 0) return
    const partners = w.cell_partners?.[t]?.[s] ?? []
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setPopover({ week: w.week, type: t, sbu: s, partners, x: rect.left, y: rect.bottom + 6 })
  }

  return (
    <>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: 200, textAlign: 'left', paddingLeft: 16 }}>Week</th>
              <th style={{ width: 100, textAlign: 'left' }}>Type</th>
              {SBUS.map(s => <th key={s}>{s}</th>)}
              <th style={{ background: 'var(--hdr2)' }}>Week total</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((w, wi) => {
              const prev = weekly[wi + 1]
              let weekTot = 0
              return (
                <>
                  <tr key={w.week + '-hdr'} className="week-hdr">
                    <td colSpan={SBUS.length + 3} className={w.current ? 'current' : ''}>
                      {w.week}{w.current ? ' · CURRENT WEEK' : ''}
                      {w.note && <span style={{ fontSize: 10, fontWeight: 400, opacity: .85, marginLeft: 8 }}>· {w.note}</span>}
                    </td>
                  </tr>
                  {TYPES.map(t => {
                    let rowTot = 0
                    return (
                      <tr key={w.week + t}>
                        <td />
                        <td className="type-cell">{t}</td>
                        {SBUS.map(s => {
                          const n     = w.cells[t][s]
                          const prior = prev ? prev.cells[t][s] : null
                          const hasNames = (w.cell_partners?.[t]?.[s] ?? []).length > 0
                          rowTot += n
                          let trend = null
                          if (prior !== null && !w.current) {
                            if (n > prior)      trend = <span className="trend-up"> ↑{n - prior}</span>
                            else if (n < prior) trend = <span className="trend-dn"> ↓{prior - n}</span>
                          }
                          return (
                            <td
                              key={s}
                              className={n === 0 ? 'num-zero' : 'num-hit'}
                              onClick={n > 0 ? e => handleCellClick(e, w, t, s, n) : undefined}
                              style={n > 0 ? { cursor: 'pointer', position: 'relative' } : undefined}
                              title={n > 0 ? (hasNames ? 'Click to see partners' : 'Click for details') : undefined}
                            >
                              {n}{trend}
                              {n > 0 && <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.55 }}>▸</span>}
                            </td>
                          )
                        })}
                        <td style={{ background: 'var(--s)', fontWeight: 700 }}>
                          {(() => { weekTot += rowTot; return rowTot })()}
                        </td>
                      </tr>
                    )
                  })}
                  <tr key={w.week + '-total'} className="row-total">
                    <td /><td className="type-cell">Total</td>
                    {SBUS.map(s => (
                      <td key={s}>{TYPES.reduce((a, t) => a + w.cells[t][s], 0)}</td>
                    ))}
                    <td className="week-total">{weekTot}</td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {popover && (
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: Math.min(popover.y, window.innerHeight - 220),
            left: Math.min(popover.x, window.innerWidth - 260),
            zIndex: 9999,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
            padding: '12px 16px',
            minWidth: 220,
            maxWidth: 300,
          }}
        >
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {popover.type} · {popover.sbu}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>{popover.week}</div>
          {popover.partners.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {popover.partners.map(p => (
                <li key={p} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <button
                    onClick={() => { setPopover(null); navigate(`/partner/${encodeURIComponent(p)}`) }}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#0f766e', fontWeight: 600, padding: '5px 0', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {p} <span style={{ fontSize: 10, opacity: 0.6 }}>→</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
              Names not tracked for this cell.
            </div>
          )}
          <button
            onClick={() => setPopover(null)}
            style={{ marginTop: 10, fontSize: 10, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Close
          </button>
        </div>
      )}
    </>
  )
}

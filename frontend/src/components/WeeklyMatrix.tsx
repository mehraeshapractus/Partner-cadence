import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { WeekRow, LiveData, Partner } from '../types'

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

export default function WeeklyMatrix({ weekly, liveData = {}, partners = [] }: { weekly: WeekRow[], liveData?: Record<string, LiveData>, partners?: Partner[] }) {
  const navigate = useNavigate()
  const [popover, setPopover] = useState<Popover | null>(null)
  const [sbuFilter, setSbuFilter] = useState<SBU | 'All'>('All')
  const [spocFilter, setSpocFilter] = useState<string>('All')
  const popRef = useRef<HTMLDivElement>(null)

  const spocs = ['All', ...Array.from(new Set(partners.map(p => p.spoc).filter(Boolean))).sort()]
  const spocSet = spocFilter === 'All' ? null : new Set(partners.filter(p => p.spoc === spocFilter).map(p => p.name))

  const visibleSBUs = sbuFilter === 'All' ? SBUS : SBUS.filter(s => s === sbuFilter)

  function filteredPartners(names: string[]): string[] {
    return spocSet ? names.filter(n => spocSet.has(n)) : names
  }

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
    const allNames = w.cell_partners?.[t]?.[s] ?? []
    const names = filteredPartners(allNames)
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setPopover({ week: w.week, type: t, sbu: s, partners: names, x: rect.left, y: rect.bottom + 6 })
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {(['All', ...SBUS] as const).map(s => (
          <button
            key={s}
            onClick={() => setSbuFilter(s as SBU | 'All')}
            style={{
              fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 20,
              border: '1px solid',
              borderColor: sbuFilter === s ? 'var(--hdr)' : '#e2e8f0',
              background: sbuFilter === s ? 'var(--hdr)' : '#fff',
              color: sbuFilter === s ? '#fff' : '#64748b',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {spocs.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 2 }}>SPOC</span>
          {spocs.map(s => (
            <button
              key={s}
              onClick={() => setSpocFilter(s)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 20,
                border: '1px solid',
                borderColor: spocFilter === s ? '#0f766e' : '#e2e8f0',
                background: spocFilter === s ? '#0f766e' : '#fff',
                color: spocFilter === s ? '#fff' : '#64748b',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: 200, textAlign: 'left', paddingLeft: 16 }}>Week</th>
              <th style={{ width: 100, textAlign: 'left' }}>Type</th>
              {visibleSBUs.map(s => <th key={s}>{s}</th>)}
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
                    <td colSpan={visibleSBUs.length + 3} className={w.current ? 'current' : ''}>
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
                        {visibleSBUs.map(s => {
                          const rawNames  = w.cell_partners?.[t]?.[s] ?? []
                          const names     = filteredPartners(rawNames)
                          const n         = spocSet ? names.length : w.cells[t][s]
                          const rawPrior  = prev ? (spocSet ? filteredPartners(prev.cell_partners?.[t]?.[s] ?? []).length : prev.cells[t][s]) : null
                          const prior     = rawPrior
                          const hasNames  = names.length > 0
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
                    {visibleSBUs.map(s => (
                      <td key={s}>{TYPES.reduce((a, t) => {
                        const names = filteredPartners(w.cell_partners?.[t]?.[s] ?? [])
                        return a + (spocSet ? names.length : w.cells[t][s])
                      }, 0)}</td>
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
                    onClick={() => {
                      setPopover(null)
                      const reportUrl = liveData[p]?.report_url
                      if (reportUrl) {
                        window.open(reportUrl, '_blank', 'noopener,noreferrer')
                      } else {
                        navigate(`/partner/${encodeURIComponent(p)}`)
                      }
                    }}
                    title={liveData[p]?.report_url ? 'Open Read.ai report' : 'View partner details'}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#0f766e', fontWeight: 600, padding: '5px 0', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {p}
                    <span style={{ fontSize: 10, opacity: 0.6 }}>
                      {liveData[p]?.report_url ? '↗' : '→'}
                    </span>
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

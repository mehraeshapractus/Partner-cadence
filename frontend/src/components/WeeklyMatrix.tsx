import { WeekRow } from '../types'

const SBUS  = ['US', 'India', 'MEA', 'Global', 'Unassigned'] as const
const TYPES = ['BD Partner', 'Partner', 'SME'] as const

export default function WeeklyMatrix({ weekly }: { weekly: WeekRow[] }) {
  return (
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
                        const n    = w.cells[t][s]
                        const prior = prev ? prev.cells[t][s] : null
                        rowTot += n
                        let trend = null
                        if (prior !== null && !w.current) {
                          if (n > prior)      trend = <span className="trend-up"> ↑{n - prior}</span>
                          else if (n < prior) trend = <span className="trend-dn"> ↓{prior - n}</span>
                        }
                        return (
                          <td key={s} className={n === 0 ? 'num-zero' : 'num-hit'}>
                            {n}{trend}
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
  )
}

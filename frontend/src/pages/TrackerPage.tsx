import { useEffect, useState, useCallback } from "react"
import { Partner, LiveData, WeekRow } from "../types"
import WeeklyMatrix from "../components/WeeklyMatrix"
import PartnerTable from "../components/PartnerTable"

const LS_KEY = "practus-tracker-ticks-v2"

function parseDate(s: string): Date | null {
  if (!s || s === "TBD" || s.toLowerCase().includes("recurring")) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function loadTicks(): Record<string, { at: string }> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") } catch { return {} }
}
function saveTicks(t: Record<string, { at: string }>) {
  localStorage.setItem(LS_KEY, JSON.stringify(t))
}

export default function TrackerPage() {
  const [partners,      setPartners]      = useState<Partner[]>([])
  const [liveData,      setLiveData]      = useState<Record<string, LiveData>>({})
  const [weekly,        setWeekly]        = useState<WeekRow[]>([])
  const [ticks,         setTicks]         = useState<Record<string, { at: string }>>(loadTicks)
  const [loading,       setLoading]       = useState(true)
  const [syncedAt,      setSyncedAt]      = useState<string | null>(null)
  const [manualActions, setManualActions] = useState<Record<string, string[]>>({})

  const [openCadence,        setOpenCadence]        = useState(true)
  const [cadenceDays,        setCadenceDays]        = useState(14)
  const [openWithActions,    setOpenWithActions]    = useState(true)
  const [withActionsDays,    setWithActionsDays]    = useState(0)

  const [sbu,    setSbu]    = useState("")
  const [type,   setType]   = useState("")
  const [stage,  setStage]  = useState("")
  const [spoc,   setSpoc]   = useState("")
  const [view,   setView]   = useState<"all"|"actions"|"idle">("all")
  const [search, setSearch] = useState("")

  const fetchData = useCallback(async () => {
    try {
      const [pRes, wRes, mRes] = await Promise.all([fetch("/api/partners"), fetch("/api/weekly"), fetch("/api/manual-actions")])
      const pJson = await pRes.json()
      const wJson = await wRes.json()
      const mJson = await mRes.json()
      setPartners(pJson.partners || [])
      setLiveData(pJson.live_data || {})
      setWeekly(wJson.weekly || [])
      setSyncedAt(pJson.synced_at)
      setManualActions(mJson.manual_actions || {})
    } catch { } finally {
      setLoading(false)
    }
  }, [])

  const addManualAction = useCallback(async (partnerName: string, text: string) => {
    const r = await fetch(`/api/manual-actions/${encodeURIComponent(partnerName)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    const d = await r.json()
    if (d.ok) setManualActions(prev => ({ ...prev, [partnerName]: d.actions }))
  }, [])

  const deleteManualAction = useCallback(async (partnerName: string, index: number) => {
    await fetch(`/api/manual-actions/${encodeURIComponent(partnerName)}/${index}`, { method: "DELETE" })
    setManualActions(prev => {
      const acts = [...(prev[partnerName] || [])]
      acts.splice(index, 1)
      const next = { ...prev }
      if (acts.length) next[partnerName] = acts; else delete next[partnerName]
      return next
    })
  }, [])

  useEffect(() => {
    fetchData()
    window.addEventListener("practus:synced", fetchData)
    return () => window.removeEventListener("practus:synced", fetchData)
  }, [fetchData])

  useEffect(() => {
    async function handleExport() {
      const { jsPDF } = await import('jspdf')
      const autoTable  = (await import('jspdf-autotable')).default

      const today   = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      const grouped: { partner: Partner; actions: string[] }[] = []
      partners.forEach(p => {
        const ld     = liveData[p.name] || { notes: "", actions: [], last_meeting: "" }
        const hcDone = (p.actions || []).filter((_, i) => ticks[`${p.name}::${i}`])
        const lvDone = (ld.actions || []).filter(a => ticks[`live::${p.name}::${fnvHash(a.trim())}`])
        const all    = [...hcDone, ...lvDone]
        if (all.length) grouped.push({ partner: p, actions: all })
      })

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const teal = [14, 122, 114] as [number, number, number]
      const navy = [27,  43,  58] as [number, number, number]
      const grey = [122, 156, 168] as [number, number, number]

      // Header bar
      doc.setFillColor(...teal)
      doc.rect(0, 0, 210, 14, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('PRACTUS PARTNER ACTION TRACKER', 14, 9.5)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(`Ticked actions export  ·  ${today}  ·  ${grouped.length} partner${grouped.length !== 1 ? 's' : ''}`, 14, 21)
      doc.setTextColor(...grey)

      if (grouped.length === 0) {
        doc.setFontSize(11)
        doc.setTextColor(...grey)
        doc.text('No actions have been ticked yet.', 14, 34)
      } else {
        const tableRows = grouped.flatMap(({ partner: p, actions }) =>
          actions.map((a, ai) => [
            ai === 0 ? p.name : '',
            ai === 0 ? (p.spoc || '—') : '',
            ai === 0 ? (p.sbu  || '—') : '',
            ai === 0 ? p.type : '',
            `✓  ${a}`,
          ])
        )

        autoTable(doc, {
          startY: 27,
          head: [['Partner', 'SPOC', 'SBU', 'Type', 'Action (ticked done)']],
          body: tableRows,
          styles:     { fontSize: 8.5, cellPadding: 3, textColor: navy, lineColor: [220, 232, 232], lineWidth: 0.2 },
          headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold', fontSize: 8 },
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 34 },
            1: { cellWidth: 26 },
            2: { cellWidth: 18 },
            3: { cellWidth: 24 },
            4: { cellWidth: 'auto' },
          },
          alternateRowStyles: { fillColor: [240, 250, 250] },
          didDrawCell: (data: { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; height: number } }) => {
            if (data.section === 'body' && data.column.index === 0 && data.row.index > 0) {
              const prev = tableRows[data.row.index - 1]
              const curr = tableRows[data.row.index]
              if (prev && curr && prev[0] !== curr[0] && curr[0] !== '') {
                doc.setDrawColor(...teal)
                doc.setLineWidth(0.5)
                doc.line(data.cell.x, data.cell.y, data.cell.x + 190, data.cell.y)
              }
            }
          },
        })
      }

      // Footer
      const pageH = doc.internal.pageSize.height
      doc.setFontSize(7)
      doc.setTextColor(...grey)
      doc.text('Practus Advisors  ·  Confidential  ·  Partner Tracker Master', 14, pageH - 6)
      doc.text(today, 196, pageH - 6, { align: 'right' })

      doc.save(`Practus_Ticked_Actions_${today.replace(/ /g, '_')}.pdf`)
    }

    window.addEventListener("practus:export", handleExport)
    return () => window.removeEventListener("practus:export", handleExport)
  }, [partners, liveData, ticks])

  function onTick(key: string, checked: boolean) {
    setTicks(prev => {
      const next = { ...prev }
      if (checked) next[key] = { at: new Date().toISOString() }
      else delete next[key]
      saveTicks(next)
      return next
    })
  }

  const spocs = [...new Set(partners.map(p => p.spoc).filter(Boolean))].sort()

  let filtered = partners
  if (sbu)    filtered = filtered.filter(p => (p.sbu || "Unassigned") === sbu)
  if (type)   filtered = filtered.filter(p => p.type === type)
  if (stage)  filtered = filtered.filter(p => p.stage === stage)
  if (spoc)   filtered = filtered.filter(p => p.spoc === spoc)
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(p => (p.name + p.spoc + p.category + p.comments).toLowerCase().includes(q))
  }

  const hasAny = (p: Partner) =>
    (p.actions || []).length > 0 ||
    (liveData[p.name]?.actions || []).length > 0 ||
    (manualActions[p.name] || []).length > 0

  const stageOrd: Record<string, number> = { "GTM Active": 0, "Business Referred": 1, "Discussion Initiated": 2 }
  const sortFn = (a: Partner, b: Partner) => {
    // partners with actions always sort before those without
    const ha = hasAny(a) ? 0 : 1, hb = hasAny(b) ? 0 : 1
    if (ha !== hb) return ha - hb
    return (stageOrd[a.stage] ?? 9) - (stageOrd[b.stage] ?? 9) || a.name.localeCompare(b.name)
  }

  let displayPartners = [...filtered].sort(sortFn)
  if (view === "actions") displayPartners = displayPartners.filter(hasAny)
  if (view === "idle")    displayPartners = displayPartners.filter(p => !hasAny(p))

  if (withActionsDays > 0) {
    const waCutoff = new Date()
    waCutoff.setDate(waCutoff.getDate() - withActionsDays)
    displayPartners = displayPartners.filter(p => {
      const lm = liveData[p.name]?.last_meeting || p.last_meeting
      const d  = parseDate(lm)
      return d !== null && d >= waCutoff
    })
  }

  const total        = filtered.length
  const gtm          = filtered.filter(p => p.stage === "GTM Active").length
  const referred     = filtered.filter(p => p.stage === "Business Referred").length
  const openActions  = filtered.reduce((s, p) => {
    const hc = (p.actions || []).filter((_, i) => !ticks[`${p.name}::${i}`]).length
    const lv = (liveData[p.name]?.actions || []).filter(a => !ticks[`live::${p.name}::${fnvHash(a.trim())}`]).length
    const mn = (manualActions[p.name] || []).filter(a => !ticks[`manual::${p.name}::${fnvHash(a.trim())}`]).length
    return s + hc + lv + mn
  }, 0)
  const doneActions  = filtered.reduce((s, p) => {
    const hc = (p.actions || []).filter((_, i) => !!ticks[`${p.name}::${i}`]).length
    const lv = (liveData[p.name]?.actions || []).filter(a => !!ticks[`live::${p.name}::${fnvHash(a.trim())}`]).length
    const mn = (manualActions[p.name] || []).filter(a => !!ticks[`manual::${p.name}::${fnvHash(a.trim())}`]).length
    return s + hc + lv + mn
  }, 0)

  const today = new Date()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - cadenceDays)

  const recentPartners = filtered
    .map(p => {
      const ld  = liveData[p.name]
      const lm  = ld?.last_meeting || p.last_meeting
      const d   = parseDate(lm)
      return { p, ld, lm, d }
    })
    .filter(({ d }) => d !== null && (cadenceDays === 0 ? true : d! >= cutoff))
    .sort((a, b) => (b.d!.getTime()) - (a.d!.getTime()))

  if (loading) return <div className="loading">Loading partner data...</div>

  return (
    <>
      {weekly.length > 0 && (
        <div className="matrix-wrap">
          <h2>Weekly partner-calls matrix &mdash; Week-over-week (Apr 20 &rarr; today)</h2>
          <WeeklyMatrix weekly={weekly} />
        </div>
      )}

      <div className="controls">
        <div className="control-group">
          <label>SBU</label>
          <select value={sbu} onChange={e => setSbu(e.target.value)}>
            <option value="">All</option>
            {["US","India","MEA","Global","Unassigned"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">All</option>
            {["BD Partner","Partner","SME"].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)}>
            <option value="">All</option>
            {["GTM Active","Business Referred","Discussion Initiated"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>SPOC</label>
          <select value={spoc} onChange={e => setSpoc(e.target.value)}>
            <option value="">All</option>
            {spocs.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>View</label>
          <select value={view} onChange={e => setView(e.target.value as typeof view)}>
            <option value="all">All partners</option>
            <option value="actions">With open actions</option>
            <option value="idle">No actions only</option>
          </select>
        </div>
        <div className="control-group">
          <label>Search</label>
          <input type="text" placeholder="Search partner..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="summary-bar">
        <div className="stat">
          <div className="num">{total}</div><div className="lbl">Partners in view</div>
        </div>
        <div className={`stat accent clickable${stage === "GTM Active" ? " active-stat" : ""}`} onClick={() => setStage(s => s === "GTM Active" ? "" : "GTM Active")}>
          <div className="num">{gtm}</div><div className="lbl">GTM Active</div>
        </div>
        <div className={`stat green clickable${stage === "Business Referred" ? " active-stat" : ""}`} onClick={() => setStage(s => s === "Business Referred" ? "" : "Business Referred")}>
          <div className="num">{referred}</div><div className="lbl">Business Referred</div>
        </div>
        <div className={`stat accent clickable${view === "actions" ? " active-stat" : ""}`} onClick={() => setView(v => v === "actions" ? "all" : "actions")}>
          <div className="num">{openActions}</div><div className="lbl">Open Actions</div>
        </div>
        <div className="stat green">
          <div className="num">{doneActions}</div><div className="lbl">Ticked Done</div>
        </div>
      </div>

      {!total && <div className="empty">No partners match the current filters.</div>}

      {total > 0 && (
        <>
          <div className="section-hdr collapsible" onClick={() => setOpenWithActions(o => !o)}>
            <span className={`chevron ${openWithActions ? "open" : ""}`}>&#x203A;</span>
            Partners with logged next steps
            <select
              value={withActionsDays}
              onClick={e => e.stopPropagation()}
              onChange={e => setWithActionsDays(Number(e.target.value))}
              style={{ marginLeft: 8, marginRight: 6, fontSize: 11, padding: '1px 4px', border: '1px solid var(--border-md)', borderRadius: 3, background: '#fff', cursor: 'pointer' }}
            >
              <option value={0}>All time</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
            </select>
            <span className="count">{displayPartners.length} partners</span>
          </div>
          {openWithActions && (
            displayPartners.length === 0
              ? <div className="empty" style={{ fontSize: 12 }}>No partners match this time window.</div>
              : <PartnerTable partners={displayPartners} liveData={liveData} ticks={ticks} onTick={onTick} manualActions={manualActions} onAddAction={addManualAction} onDeleteAction={deleteManualAction} />
          )}
        </>
      )}

      <div className="section-hdr collapsible" style={{ background: 'var(--teal-xlight, #f0fdfa)', borderLeft: '3px solid var(--teal-d, #0f766e)' }} onClick={() => setOpenCadence(o => !o)}>
        <span className={`chevron ${openCadence ? "open" : ""}`}>&#x203A;</span>
        Cadence exception &mdash; partners called in last
        <select
          value={cadenceDays}
          onClick={e => e.stopPropagation()}
          onChange={e => setCadenceDays(Number(e.target.value))}
          style={{ marginLeft: 6, marginRight: 6, fontSize: 11, padding: '1px 4px', border: '1px solid #99f6e4', borderRadius: 3, background: '#fff', cursor: 'pointer' }}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={0}>All time</option>
        </select>
        <span className="count">{recentPartners.length} partners</span>
      </div>
      {openCadence && (
        recentPartners.length === 0
          ? <div className="empty" style={{ fontSize: 12 }}>No partner calls recorded in this window. Sync to refresh.</div>
          : <div className="report-tbl-wrap">
              <table className="report-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th style={{ minWidth: 130 }}>Partner</th>
                    <th style={{ minWidth: 90 }}>SPOC</th>
                    <th style={{ minWidth: 65 }}>SBU</th>
                    <th style={{ minWidth: 75 }}>Type</th>
                    <th style={{ minWidth: 90 }}>Last Meeting</th>
                    <th style={{ minWidth: 65, textAlign: 'center' }}>Days ago</th>
                    <th style={{ minWidth: 110 }}>Read.ai report</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPartners.map(({ p, ld, lm, d }, i) => {
                    const daysAgo   = Math.floor((today.getTime() - d!.getTime()) / 86400000)
                    const reportUrl = ld?.report_url || ''
                    return (
                      <tr key={p.name}>
                        <td style={{ textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5 }}>{i + 1}</td>
                        <td><strong style={{ color: 'var(--hdr)', fontSize: 12 }}>{p.name}</strong></td>
                        <td style={{ fontSize: 11 }}>{p.spoc || <span className="r-nd">&mdash;</span>}</td>
                        <td><span className="sbu-tag">{p.sbu || 'Unassigned'}</span></td>
                        <td><span className={`type-pill ${p.type === 'BD Partner' ? 'bd' : p.type === 'Partner' ? 'pt' : 'sme'}`}>{p.type}</span></td>
                        <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{lm}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`days-ago-badge ${daysAgo <= 7 ? 'ok' : daysAgo <= 21 ? 'warn' : 'late'}`}>{daysAgo}d</span>
                        </td>
                        <td>
                          {reportUrl
                            ? <a href={reportUrl} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 10.5, color: 'var(--teal-d)', textDecoration: 'none', background: '#f0fdfa', border: '1px solid #99f6e4', padding: '2px 8px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                                &#x1F4CB; Report
                              </a>
                            : <span className="r-nd">&mdash;</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
      )}

      {syncedAt && (
        <div className="footnote">Last synced: {new Date(syncedAt).toLocaleString()}</div>
      )}
    </>
  )
}

export function fnvHash(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (Math.imul(h, 0x01000193)) >>> 0
  }
  return h.toString(36)
}
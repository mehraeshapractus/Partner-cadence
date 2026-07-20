import asyncio
import copy
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from graph import run_sync
from partners import PARTNERS, WEEKLY

# In-memory cache — replaced after each sync
_cache: dict = {
    "live_data": {},
    "weekly": copy.deepcopy(WEEKLY),
    "errors": [],
    "synced_at": None,
}

# Manual actions — persisted to file
MANUAL_FILE: Path = Path(__file__).parent / "manual_actions.json"
_manual: Dict[str, List[str]] = {}

def _load_manual():
    global _manual
    try:
        if MANUAL_FILE.exists():
            _manual = json.loads(MANUAL_FILE.read_text())
    except Exception:
        _manual = {}

def _save_manual():
    try:
        MANUAL_FILE.write_text(json.dumps(_manual, indent=2))
    except Exception:
        pass

# Manual report URLs — keyed by partner name; never overrides a synced report_url
REPORTS_FILE: Path = Path(__file__).parent / "manual_reports.json"
_reports: Dict[str, str] = {}

def _load_reports():
    global _reports
    try:
        if REPORTS_FILE.exists():
            _reports = json.loads(REPORTS_FILE.read_text())
    except Exception:
        _reports = {}

# Manual meetings — keyed by partner name; list of {date, url, title}
MEETINGS_FILE: Path = Path(__file__).parent / "manual_meetings.json"
_meetings_manual: Dict[str, List[Dict]] = {}

def _load_meetings_manual():
    global _meetings_manual
    try:
        if MEETINGS_FILE.exists():
            _meetings_manual = json.loads(MEETINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        _meetings_manual = {}

def _save_meetings_manual():
    try:
        MEETINGS_FILE.write_text(json.dumps(_meetings_manual, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

# Action states — persisted to file
STATES_FILE: Path = Path(__file__).parent / "action_states.json"
_states: Dict[str, Dict[str, str]] = {}

def _load_states():
    global _states
    try:
        if STATES_FILE.exists():
            _states = json.loads(STATES_FILE.read_text(encoding="utf-8"))
    except Exception:
        _states = {}

def _save_states():
    try:
        STATES_FILE.write_text(json.dumps(_states, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


async def do_sync():
    result = await run_sync()
    _cache["live_data"] = result.get("live_data", {})
    _cache["weekly"]    = result.get("weekly", WEEKLY)
    _cache["errors"]    = result.get("errors", [])
    _cache["synced_at"] = result.get("synced_at")


async def _auto_sync_loop():
    """Run sync every 2 hours automatically."""
    await asyncio.sleep(60)          # short delay so startup completes first
    while True:
        try:
            await do_sync()
        except Exception:
            pass
        await asyncio.sleep(2 * 60 * 60)  # 2 hours


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_manual()
    _load_prospects()
    _load_states()
    _load_reports()
    _load_meetings_manual()
    asyncio.create_task(do_sync())         # warm sync on startup
    asyncio.create_task(_auto_sync_loop()) # auto-sync every 2 hours
    yield


app = FastAPI(title="Practus Partner Tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5176", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/partners")
async def get_partners():
    partners = [
        {**p, "prospects": list(p.get("prospects", [])) + _prospects.get(p["name"], [])}
        for p in PARTNERS
    ]
    # Merge manual report URLs as fallback (sync data takes precedence)
    live = {k: dict(v) for k, v in _cache["live_data"].items()}
    partner_map = {p["name"]: p for p in PARTNERS}
    for pname, rurl in _reports.items():
        entry = live.setdefault(pname, {})
        if not entry.get("report_url"):
            entry["report_url"] = rurl
        # If no meetings_history yet, build one from the partner's last_meeting date
        if not entry.get("meetings_history"):
            pdata = partner_map.get(pname, {})
            lm_date = entry.get("last_meeting") or pdata.get("last_meeting", "")
            if lm_date:
                entry["meetings_history"] = [{"date": lm_date, "url": rurl, "title": "Partner meeting"}]
    # Merge manually-added meetings (marked manual=True so frontend can identify them)
    for pname, mtgs in _meetings_manual.items():
        entry = live.setdefault(pname, {"notes": "", "actions": [], "last_meeting": "", "report_url": "", "meetings_history": []})
        if "meetings_history" not in entry:
            entry["meetings_history"] = []
        existing_dates = {m.get("date", "") for m in entry["meetings_history"]}
        for i, mtg in enumerate(mtgs):
            if mtg.get("date") and mtg["date"] not in existing_dates:
                entry["meetings_history"].append({**mtg, "manual": True, "manual_idx": i})
                existing_dates.add(mtg["date"])
        entry["meetings_history"].sort(key=lambda m: m.get("date", ""), reverse=True)
    return {
        "partners":   partners,
        "live_data":  live,
        "synced_at":  _cache["synced_at"],
        "errors":     _cache["errors"],
    }


@app.get("/api/weekly")
async def get_weekly():
    return {"weekly": _cache["weekly"]}


@app.post("/api/sync")
async def trigger_sync():
    import traceback
    try:
        await do_sync()
    except Exception as e:
        return {
            "ok":    False,
            "error": str(e),
            "trace": traceback.format_exc(),
        }
    return {
        "ok":             True,
        "partners_synced": len(_cache["live_data"]),
        "synced_at":      _cache["synced_at"],
        "errors":         _cache["errors"],
    }


@app.get("/api/report")
async def get_report():
    rows = []
    for p in PARTNERS:
        ld       = _cache["live_data"].get(p["name"], {})
        man_acts = _manual.get(p["name"], [])
        man_pros = _prospects.get(p["name"], [])
        has_data = (
            bool(p.get("actions"))
            or bool(p.get("comments"))
            or bool(p.get("last_meeting"))
            or bool(ld.get("notes"))
            or bool(ld.get("actions"))
            or bool(ld.get("last_meeting"))
            or bool(man_acts)
            or bool(man_pros)
        )
        if not has_data:
            continue
        rows.append({
            **p,
            "live_notes":       ld.get("notes", ""),
            "live_actions":     ld.get("actions", []),
            "live_last_meeting": ld.get("last_meeting", ""),
            "manual_actions":   man_acts,
            "manual_prospects": man_pros,
        })
    return {
        "rows":         rows,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "synced_at":    _cache["synced_at"],
    }


# Manual prospects — persisted to file
PROSPECTS_FILE: Path = Path(__file__).parent / "manual_prospects.json"
_prospects: Dict[str, List[str]] = {}

def _load_prospects():
    global _prospects
    try:
        if PROSPECTS_FILE.exists():
            _prospects = json.loads(PROSPECTS_FILE.read_text())
    except Exception:
        _prospects = {}

def _save_prospects():
    try:
        PROSPECTS_FILE.write_text(json.dumps(_prospects, indent=2))
    except Exception:
        pass


@app.get("/api/manual-actions")
async def get_manual_actions():
    return {"manual_actions": _manual}

@app.post("/api/manual-actions/{partner_name}")
async def add_manual_action(partner_name: str, body: dict = Body(...)):
    text = (body.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "empty text"}
    _manual.setdefault(partner_name, []).append(text)
    _save_manual()
    return {"ok": True, "actions": _manual[partner_name]}

@app.delete("/api/manual-actions/{partner_name}/{index}")
async def delete_manual_action(partner_name: str, index: int):
    acts = _manual.get(partner_name, [])
    if 0 <= index < len(acts):
        acts.pop(index)
        if not acts:
            del _manual[partner_name]
        _save_manual()
    return {"ok": True}


@app.get("/api/manual-meetings/{partner_name}")
async def get_manual_meetings(partner_name: str):
    from urllib.parse import unquote
    pname = unquote(partner_name)
    return {"meetings": _meetings_manual.get(pname, [])}

@app.post("/api/manual-meetings/{partner_name}")
async def add_manual_meeting(partner_name: str, body: dict = Body(...)):
    from urllib.parse import unquote
    pname = unquote(partner_name)
    date  = (body.get("date")  or "").strip()
    url   = (body.get("url")   or "").strip()
    title = (body.get("title") or "").strip()
    if not date:
        return {"ok": False, "error": "date required"}
    _meetings_manual.setdefault(pname, []).append({"date": date, "url": url, "title": title or "Partner meeting"})
    _meetings_manual[pname].sort(key=lambda m: m.get("date", ""), reverse=True)
    _save_meetings_manual()
    return {"ok": True, "meetings": _meetings_manual[pname]}

@app.delete("/api/manual-meetings/{partner_name}/{index}")
async def delete_manual_meeting(partner_name: str, index: int):
    from urllib.parse import unquote
    pname = unquote(partner_name)
    mtgs  = _meetings_manual.get(pname, [])
    if 0 <= index < len(mtgs):
        mtgs.pop(index)
        if not mtgs:
            del _meetings_manual[pname]
        _save_meetings_manual()
    return {"ok": True}


@app.get("/api/manual-prospects")
async def get_manual_prospects():
    return {"manual_prospects": _prospects}

@app.post("/api/manual-prospects/{partner_name}")
async def add_manual_prospect(partner_name: str, body: dict = Body(...)):
    text = (body.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "empty text"}
    _prospects.setdefault(partner_name, []).append(text)
    _save_prospects()
    return {"ok": True, "prospects": _prospects[partner_name]}

@app.delete("/api/manual-prospects/{partner_name}/{index}")
async def delete_manual_prospect(partner_name: str, index: int):
    pros = _prospects.get(partner_name, [])
    if 0 <= index < len(pros):
        pros.pop(index)
        if not pros:
            del _prospects[partner_name]
        _save_prospects()
    return {"ok": True}


@app.get("/api/action-states/{partner_name}")
async def get_action_states(partner_name: str):
    from urllib.parse import unquote
    pname = unquote(partner_name)
    return {"states": _states.get(pname, {})}

@app.post("/api/action-states")
async def set_action_state(body: dict = Body(...)):
    partner = body.get("partner", "")
    key     = body.get("key", "")      # first 60 chars of action text, stripped
    state   = body.get("state", "")   # "open" or "done"
    if not partner or not key or state not in ("open", "done"):
        return {"ok": False, "error": "Invalid input"}
    _states.setdefault(partner, {})[key] = state
    _save_states()
    return {"ok": True}


@app.get("/api/health")
async def health():
    return {"ok": True, "synced_at": _cache["synced_at"]}


@app.get("/api/debug-readai")
async def debug_readai():
    """Fetch first page of Read.ai meetings and return raw response for debugging."""
    import httpx
    from readai_auth import get_access_token as _readai_token
    token = await _readai_token()
    if not token:
        return {"error": "Not authorized — run readai_setup.py and set READAI_TOKEN_JSON in Railway"}
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://api.read.ai/v1/meetings",
                headers=headers,
                params={"page_size": 10},
            )
            body = r.json()
            meetings = body.get("data", [])
            # Show raw fields for first 10 meetings
            sample = []
            for m in meetings[:10]:
                sample.append({
                    "id": m.get("id"),
                    "title": m.get("title"),
                    "start_time_ms": m.get("start_time_ms"),
                    "live_enabled": m.get("live_enabled"),
                    "platform": m.get("platform"),
                    "folders": m.get("folders"),
                    "folder": m.get("folder"),
                    "collections": m.get("collections"),
                    "collection": m.get("collection"),
                    "tags": m.get("tags"),
                    "report_url": m.get("report_url"),
                    "all_keys": list(m.keys()),
                })
            # Also fetch detail for first meeting
            detail_sample = {}
            if meetings:
                mid = meetings[0].get("id")
                dr = await client.get(f"https://api.read.ai/v1/meetings/{mid}", headers=headers)
                if dr.status_code == 200:
                    detail_sample = dr.json()
            return {
                "status_code": r.status_code,
                "total_count": len(meetings),
                "pagination": body.get("pagination") or body.get("meta") or body.get("next_cursor"),
                "meetings_sample": sample,
                "first_meeting_detail_keys": list((detail_sample.get("data") or detail_sample).keys()),
            }
    except Exception as e:
        return {"error": str(e)}


# ── Production: serve Vite build ──────────────────────────────────────────────
_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def _spa(full_path: str):
        fp = _DIST / full_path
        if fp.is_file():
            return FileResponse(fp)
        return FileResponse(_DIST / "index.html")

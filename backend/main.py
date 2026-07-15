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


async def do_sync():
    result = await run_sync()
    _cache["live_data"] = result.get("live_data", {})
    _cache["weekly"]    = result.get("weekly", WEEKLY)
    _cache["errors"]    = result.get("errors", [])
    _cache["synced_at"] = result.get("synced_at")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_manual()
    _load_prospects()
    asyncio.create_task(do_sync())   # warm sync on startup
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
    return {
        "partners":   partners,
        "live_data":  _cache["live_data"],
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

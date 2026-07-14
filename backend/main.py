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
    partners = [{**p, "prospects": p.get("prospects", [])} for p in PARTNERS]
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
        ld = _cache["live_data"].get(p["name"], {})
        has_data = (
            bool(p.get("actions"))
            or bool(p.get("comments"))
            or bool(ld.get("notes"))
            or bool(ld.get("actions"))
            or bool(ld.get("last_meeting"))
        )
        if not has_data:
            continue
        rows.append({
            **p,
            "live_notes":        ld.get("notes", ""),
            "live_actions":      ld.get("actions", []),
            "live_last_meeting": ld.get("last_meeting", ""),
        })
    return {
        "rows":         rows,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "synced_at":    _cache["synced_at"],
    }


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


@app.get("/api/health")
async def health():
    return {"ok": True, "synced_at": _cache["synced_at"]}


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

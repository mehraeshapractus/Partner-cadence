import asyncio
import copy
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
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


async def do_sync():
    result = await run_sync()
    _cache["live_data"] = result.get("live_data", {})
    _cache["weekly"]    = result.get("weekly", WEEKLY)
    _cache["errors"]    = result.get("errors", [])
    _cache["synced_at"] = result.get("synced_at")


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    return {
        "partners":   PARTNERS,
        "live_data":  _cache["live_data"],
        "synced_at":  _cache["synced_at"],
        "errors":     _cache["errors"],
    }


@app.get("/api/weekly")
async def get_weekly():
    return {"weekly": _cache["weekly"]}


@app.post("/api/sync")
async def trigger_sync():
    await do_sync()
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

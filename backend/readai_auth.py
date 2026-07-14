"""
Read.ai OAuth 2.1 token manager.
Reads from .readai_token.json or READAI_TOKEN_JSON env var (for Railway).
"""
import json
import os
import time
from pathlib import Path

import httpx

TOKEN_URL  = "https://authn.read.ai/oauth2/token"
TOKEN_FILE = Path(__file__).parent / ".readai_token.json"

_cache: dict = {}


def _load() -> dict:
    global _cache
    if TOKEN_FILE.exists():
        _cache = json.loads(TOKEN_FILE.read_text())
    elif os.getenv("READAI_TOKEN_JSON"):
        _cache = json.loads(os.getenv("READAI_TOKEN_JSON"))
    return _cache


def _save(data: dict):
    global _cache
    _cache = data
    TOKEN_FILE.write_text(json.dumps(data, indent=2))


async def get_access_token() -> str:
    """Return a valid access token, refreshing if expired."""
    d = _load()
    if not d.get("refresh_token"):
        return ""

    if d.get("access_token") and time.time() < d.get("expires_at", 0) - 60:
        return d["access_token"]

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.post(TOKEN_URL, data={
                "grant_type":    "refresh_token",
                "refresh_token": d["refresh_token"],
                "client_id":     d["client_id"],
                "client_secret": d["client_secret"],
            })
            r.raise_for_status()
            tokens = r.json()
        _save({
            **d,
            "access_token":  tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "expires_at":    time.time() + tokens.get("expires_in", 600),
        })
        return tokens["access_token"]
    except Exception:
        # Refresh token expired — fall back to API key if available
        return os.getenv("READAI_API_KEY", "")

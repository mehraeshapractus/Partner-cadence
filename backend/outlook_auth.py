"""
Delegated Microsoft Graph token manager (device-code flow).
Reads from .outlook_token.json; auto-refreshes using the stored refresh token.
"""
import json
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

TOKEN_FILE = Path(__file__).parent / ".outlook_token.json"
TENANT_ID  = os.getenv("AZURE_TENANT_ID", "")


def _load() -> dict:
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text())
    env_json = os.getenv("OUTLOOK_TOKEN_JSON")
    if env_json:
        return json.loads(env_json)
    return {}


def _save(data: dict):
    try:
        TOKEN_FILE.write_text(json.dumps(data, indent=2))
    except Exception:
        pass  # on Railway the file path may be read-only; token still works in memory


async def get_graph_token() -> str:
    """Return a valid delegated Graph access token, refreshing if expired."""
    d = _load()
    if not d.get("refresh_token"):
        return ""

    # Still valid
    if d.get("access_token") and time.time() < d.get("expires_at", 0) - 60:
        return d["access_token"]

    # Refresh using the stored refresh token
    token_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    try:
        refresh_data = {
            "client_id":     d["client_id"],
            "refresh_token": d["refresh_token"],
            "grant_type":    "refresh_token",
            "scope":         d.get("scope", "https://graph.microsoft.com/Calendars.Read Mail.Read offline_access"),
        }
        if d.get("client_secret"):
            refresh_data["client_secret"] = d["client_secret"]
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(token_url, data=refresh_data)
            r.raise_for_status()
            tokens = r.json()
    except Exception as e:
        return ""

    _save({
        **d,
        "access_token":  tokens["access_token"],
        "refresh_token": tokens.get("refresh_token", d["refresh_token"]),
        "expires_at":    time.time() + tokens.get("expires_in", 3600),
    })
    return tokens["access_token"]

"""
One-time script to get delegated Microsoft Graph tokens for Myrah's account.
Uses device code flow — no redirect URI registration needed.

Run once:  python outlook_setup.py
Saves tokens to .outlook_token.json — backend reads this on every sync.
"""
import asyncio
import json
import os
import time

import msal
from dotenv import load_dotenv

load_dotenv()

TENANT_ID     = os.getenv("AZURE_TENANT_ID", "")
CLIENT_ID     = os.getenv("AZURE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")
TOKEN_FILE    = ".outlook_token.json"
SCOPES        = ["Calendars.Read"]


def main():
    if not all([TENANT_ID, CLIENT_ID]):
        print("ERROR: AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in .env")
        return

    # PublicClientApplication for device code flow (no redirect URI needed)
    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    )

    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        print(f"ERROR: Could not start device flow: {flow}")
        return

    print("\n" + "="*60)
    print(flow["message"])
    print("="*60 + "\n")
    print("Waiting for Myrah to sign in...")

    result = app.acquire_token_by_device_flow(flow)

    if "error" in result:
        print(f"ERROR: {result.get('error')}: {result.get('error_description')}")
        return

    data = {
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "access_token":  result["access_token"],
        "refresh_token": result.get("refresh_token", ""),
        "expires_at":    time.time() + result.get("expires_in", 3600),
        "scope":         " ".join(SCOPES),
        "flow":          "device_code",
    }
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Done! Tokens saved to {TOKEN_FILE}")
    print("Restart the backend — Outlook calendar will sync on every Sync click.")


if __name__ == "__main__":
    main()

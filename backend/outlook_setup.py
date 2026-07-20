"""
One-time script to get delegated Microsoft Graph tokens for Myrah's account.
Uses device code flow with httpx (supports confidential clients).

Run once:  python outlook_setup.py
Saves tokens to .outlook_token.json
"""
import asyncio
import json
import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

TENANT_ID     = os.getenv("AZURE_TENANT_ID", "")
CLIENT_ID     = os.getenv("AZURE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")
TOKEN_FILE    = ".outlook_token.json"
SCOPES        = "Calendars.Read Mail.Read offline_access"

DEVICE_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/devicecode"
TOKEN_URL  = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"


async def main():
    if not all([TENANT_ID, CLIENT_ID, CLIENT_SECRET]):
        print("ERROR: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET must be set in .env")
        return

    print(f"CLIENT_ID: {CLIENT_ID[:8]}... CLIENT_SECRET: {'set' if CLIENT_SECRET else 'MISSING'}")

    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: initiate device code flow
        r = await client.post(DEVICE_URL, data={
            "client_id": CLIENT_ID,
            "scope":     SCOPES,
        })
        flow = r.json()

        if "error" in flow:
            print(f"ERROR starting device flow: {flow}")
            return

        print("\n" + "="*60)
        print(flow["message"])
        print("="*60 + "\n")
        print("Waiting for Myrah to sign in...")

        interval   = int(flow.get("interval", 5))
        expires_in = int(flow.get("expires_in", 900))
        deadline   = time.time() + expires_in

        # Step 2: poll for token (omit client_secret if not set — public client)
        while time.time() < deadline:
            await asyncio.sleep(interval)

            poll_data = {
                "grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": flow["device_code"],
                "client_id":   CLIENT_ID,
            }
            if CLIENT_SECRET:
                poll_data["client_secret"] = CLIENT_SECRET
            r = await client.post(TOKEN_URL, data=poll_data)
            result = r.json()

            err = result.get("error", "")
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 5
                continue
            if err:
                print(f"ERROR: {err}: {result.get('error_description', '')}")
                return

            # Success
            data = {
                "client_id":     CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "access_token":  result["access_token"],
                "refresh_token": result.get("refresh_token", ""),
                "expires_at":    time.time() + result.get("expires_in", 3600),
                "scope":         SCOPES,
            }
            with open(TOKEN_FILE, "w") as f:
                json.dump(data, f, indent=2)

            print(f"\nDone! Tokens saved to {TOKEN_FILE}")
            return

    print("ERROR: Device flow timed out.")


if __name__ == "__main__":
    asyncio.run(main())

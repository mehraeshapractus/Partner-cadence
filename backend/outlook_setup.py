"""
One-time script to get delegated Microsoft Graph tokens for Myrah's account.
Uses authorization code flow: opens a browser, captures the OAuth redirect,
exchanges the code for tokens, and saves them to .outlook_token.json.

Run once:  python outlook_setup.py
Then copy .outlook_token.json contents into OUTLOOK_TOKEN_JSON env var on Railway.
"""
import json
import os
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Event

import httpx
from dotenv import load_dotenv

load_dotenv()

TENANT_ID     = os.getenv("AZURE_TENANT_ID", "")
CLIENT_ID     = os.getenv("AZURE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")
TOKEN_FILE    = ".outlook_token.json"
SCOPES        = "Calendars.Read Mail.Read offline_access"
REDIRECT_URI  = "http://localhost:8400/callback"

AUTH_URL  = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize"
TOKEN_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

_received_code: list = []
_shutdown = Event()


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            _received_code.append(params["code"][0])
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html><body><h2>Authorized! You can close this tab.</h2></body></html>")
        else:
            err = params.get("error", ["unknown"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(f"<html><body><h2>Error: {err}</h2></body></html>".encode())
        _shutdown.set()

    def log_message(self, *_):
        pass  # silence request logs


def main():
    if not all([TENANT_ID, CLIENT_ID]):
        print("ERROR: AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in .env")
        return

    # Step 1 — build authorization URL and open browser
    auth_params = urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "response_type": "code",
        "redirect_uri":  REDIRECT_URI,
        "scope":         SCOPES,
        "response_mode": "query",
    })
    url = f"{AUTH_URL}?{auth_params}"

    print("\n" + "=" * 60)
    print("Opening browser for Myrah to sign in...")
    print("If it doesn't open automatically, visit:")
    print(url)
    print("=" * 60 + "\n")

    webbrowser.open(url)

    # Step 2 — spin up a one-shot local server to catch the redirect
    server = HTTPServer(("localhost", 8400), _CallbackHandler)
    server.timeout = 1
    print("Waiting for sign-in (listening on http://localhost:8400/callback)...")
    while not _shutdown.is_set():
        server.handle_request()
    server.server_close()

    if not _received_code:
        print("ERROR: No authorization code received — did the browser redirect complete?")
        return

    code = _received_code[0]

    # Step 3 — exchange the authorization code for tokens
    token_data: dict = {
        "grant_type":   "authorization_code",
        "code":         code,
        "redirect_uri": REDIRECT_URI,
        "client_id":    CLIENT_ID,
        "scope":        SCOPES,
    }
    if CLIENT_SECRET:
        token_data["client_secret"] = CLIENT_SECRET

    with httpx.Client(timeout=30) as client:
        r = client.post(TOKEN_URL, data=token_data)
        result = r.json()

    if "error" in result:
        print(f"ERROR: {result['error']}: {result.get('error_description', '')}")
        return

    data = {
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "access_token":  result["access_token"],
        "refresh_token": result.get("refresh_token", ""),
        "expires_at":    time.time() + result.get("expires_in", 3600),
        "scope":         result.get("scope", SCOPES),
    }
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\nSuccess! Tokens saved to {TOKEN_FILE}")
    print(f"Granted scopes: {data['scope']}")
    print("\nNext step: copy the contents of .outlook_token.json and set it as")
    print("OUTLOOK_TOKEN_JSON environment variable in Railway.")


if __name__ == "__main__":
    main()

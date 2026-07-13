"""
One-time script to complete the Read.ai OAuth 2.1 flow.

Run once with:  python readai_setup.py
Saves tokens to .readai_token.json — the backend reads from that file on every sync.
"""
import asyncio
import base64
import hashlib
import json
import os
import secrets
import socket
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import httpx

REGISTER_URL = "https://api.read.ai/oauth/register"
AUTH_URL     = "https://authn.read.ai/oauth2/auth"
TOKEN_URL    = "https://authn.read.ai/oauth2/token"
REDIRECT_URI = "http://localhost:9876/callback"
TOKEN_FILE   = ".readai_token.json"

_auth_code:  str | None = None
_auth_error: str | None = None


def _pkce_pair():
    verifier  = secrets.token_urlsafe(64)
    digest    = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _auth_code, _auth_error
        qs     = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        _auth_error = params.get("error", [None])[0]
        _auth_code  = params.get("code",  [None])[0]
        self.send_response(200)
        self.end_headers()
        if _auth_code:
            self.wfile.write(b"<h2>Authorized! You can close this tab and return to the terminal.</h2>")
        else:
            msg = (_auth_error or "unknown error").encode()
            self.wfile.write(b"<h2>Authorization failed: " + msg + b"</h2>")

    def log_message(self, *_):
        pass


async def main():
    # 1. Register an OAuth client
    print("Step 1/3 — Registering OAuth client with Read.ai...")
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.post(REGISTER_URL, json={
            "client_name":                "Practus Tracker",
            "redirect_uris":              [REDIRECT_URI],
            "grant_types":                ["authorization_code", "refresh_token"],
            "response_types":             ["code"],
            "token_endpoint_auth_method": "client_secret_post",
        })
        if r.status_code not in (200, 201):
            print(f"  Registration failed ({r.status_code}): {r.text}")
            return
        reg = r.json()

    client_id     = reg["client_id"]
    client_secret = reg.get("client_secret", "")
    print(f"  OK — client_id: {client_id}")

    # 2. Start local callback server, open browser
    print("\nStep 2/3 — Opening browser for authorization...")
    server = HTTPServer(("localhost", 9876), _CallbackHandler)
    server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()

    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    auth_params = urllib.parse.urlencode({
        "response_type":         "code",
        "client_id":             client_id,
        "redirect_uri":          REDIRECT_URI,
        "scope":                 "openid offline meeting:read",
        "state":                 state,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
    })
    webbrowser.open(f"{AUTH_URL}?{auth_params}")
    print("  Waiting for you to log in and approve access (2-minute timeout)...")

    deadline = time.time() + 120
    while time.time() < deadline:
        if _auth_code or _auth_error:
            break
        time.sleep(0.3)
    server.shutdown()

    if _auth_error:
        print(f"  ERROR from auth server: {_auth_error}")
        return
    if not _auth_code:
        print("  ERROR: No auth code received. Try again.")
        return
    print("  Authorization code received.")

    # 3. Exchange code for tokens
    print("\nStep 3/3 — Exchanging code for tokens...")
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.post(TOKEN_URL, data={
            "grant_type":    "authorization_code",
            "code":          _auth_code,
            "redirect_uri":  REDIRECT_URI,
            "client_id":     client_id,
            "client_secret": client_secret,
            "code_verifier": verifier,
        })
        if r.status_code != 200:
            print(f"  Token exchange failed ({r.status_code}): {r.text}")
            return
        tokens = r.json()

    data = {
        "client_id":     client_id,
        "client_secret": client_secret,
        "access_token":  tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "expires_at":    time.time() + tokens.get("expires_in", 3600),
    }
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\nDone! Tokens saved to {TOKEN_FILE}")
    print("Restart the backend and it will use Read.ai automatically on every sync.")


if __name__ == "__main__":
    asyncio.run(main())

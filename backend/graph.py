"""
LangGraph sync workflow — fetches Partner Cadence call data from Read.ai
and recent emails from Microsoft Graph (Azure), then merges into partner rows.
"""
import os
import re
import copy
from datetime import datetime, timedelta, timezone
from typing import TypedDict, List, Dict, Any

import httpx
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv

from partners import PARTNERS, WEEKLY
from readai_auth import get_access_token as _readai_token
from outlook_auth import get_graph_token as _graph_delegated_token

load_dotenv()

READAI_API_KEY = os.getenv("READAI_API_KEY", "")
MYRAH_EMAIL    = os.getenv("MYRAH_EMAIL", "")

READAI_BASE = "https://api.read.ai/v1"
GRAPH_BASE  = "https://graph.microsoft.com/v1.0"

# ── State ────────────────────────────────────────────────────────────────────

class SyncState(TypedDict):
    meetings: List[Dict]        # raw Partner Cadence meetings from Read.ai
    live_data: Dict[str, Dict]  # keyed by partner name → {notes, actions, last_meeting}
    weekly: List[Dict]          # updated WEEKLY rows
    errors: List[str]
    synced_at: str


def _match_partner(email: str) -> Dict | None:
    """Match a participant to a known partner by email only (precise)."""
    email = email.lower().strip()
    if not email:
        return None
    for p in PARTNERS:
        if p.get("email", "").lower() == email:
            return p
    return None


def _match_partner_by_title(title: str) -> Dict | None:
    """Match a meeting to a partner by the non-Practus party in the title."""
    clean = re.sub(r'\bpractus\b', '', title, flags=re.I)
    clean = re.sub(r'[<>\|&/\\+\-X]', ' ', clean)  # X = common meeting separator
    clean = re.sub(r'\s+', ' ', clean).strip().lower()
    if not clean:
        return None

    best = None
    best_score = 0
    for p in PARTNERS:
        pn = p["name"].lower()
        # Exact phrase match — highest confidence
        if pn in clean:
            score = len(pn)
            if score > best_score:
                best, best_score = p, score
            continue
        # All significant words of partner name must appear in title
        pn_words = [w for w in pn.split() if len(w) > 2]
        title_words = set(clean.split())
        if pn_words and all(w in title_words for w in pn_words):
            score = sum(len(w) for w in pn_words)
            if score > best_score:
                best, best_score = p, score
    return best

# ── Nodes ────────────────────────────────────────────────────────────────────

async def fetch_readai_meetings(state: SyncState) -> SyncState:
    """Pull meetings from Read.ai (last 30 days); keep only Partner Cadence calls."""
    token = await _readai_token() or READAI_API_KEY
    if not token:
        state["errors"].append("Read.ai not authorized — run readai_setup.py")
        return state

    since_ms = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp() * 1000)
    headers  = {"Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{READAI_BASE}/meetings",
                headers=headers,
                params={"page_size": 50},
            )
            r.raise_for_status()
            all_meetings = r.json().get("data", [])
    except Exception as e:
        state["errors"].append(f"Read.ai list_meetings error: {e}")
        return state

    # Keep meetings from last 30 days that are partner/alignment/cadence calls
    def _is_partner_meeting(m: dict) -> bool:
        folders = [f.lower() for f in (m.get("folders") or [])]
        # Going-forward tags: partnership, alignment, cadence, planning (partner planning)
        if any(kw in f for f in folders for kw in ("partner", "alignment", "cadence", "planning")):
            return True
        # Historical fallback: match by title against known partners
        title = m.get("title", "")
        return _match_partner_by_title(title) is not None

    cadence = [m for m in all_meetings if m.get("start_time_ms", 0) >= since_ms and _is_partner_meeting(m)]
    state["meetings"] = cadence
    return state


async def fetch_meeting_details(state: SyncState) -> SyncState:
    """Match meetings to partners; fetch per-meeting details for action items."""
    if not state["meetings"]:
        return state

    import asyncio

    token = await _readai_token() or READAI_API_KEY
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    live: Dict[str, Dict] = state.get("live_data", {})

    now        = datetime.now(timezone.utc)
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_counts: Dict[str, Dict[str, int]] = {
        t: {"US": 0, "India": 0, "MEA": 0, "Global": 0, "Unassigned": 0}
        for t in ["BD Partner", "Partner", "SME"]
    }

    # Fetch all meeting details in parallel so we can extract action items
    async def _fetch_detail(client: httpx.AsyncClient, meeting_id: str) -> Dict:
        if not meeting_id or not headers:
            return {}
        try:
            r = await client.get(f"{READAI_BASE}/meetings/{meeting_id}", headers=headers)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            state["errors"].append(f"Read.ai detail {meeting_id}: {e}")
        return {}

    async with httpx.AsyncClient(timeout=20) as client:
        details_list = await asyncio.gather(*[
            _fetch_detail(client, m.get("id", "")) for m in state["meetings"]
        ])

    detail_map: Dict[str, Dict] = {
        m.get("id", ""): details_list[i]
        for i, m in enumerate(state["meetings"])
        if m.get("id")
    }

    for meeting in state["meetings"]:
        participants = meeting.get("participants") or []
        start_ms     = meeting.get("start_time_ms", 0)
        mtg_dt       = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc) if start_ms else None
        mtg_date     = mtg_dt.strftime("%Y-%m-%d") if mtg_dt else ""
        report_url   = meeting.get("report_url", "")
        raw_title    = meeting.get("title", "")

        _url_m = re.search(r'(https?://\S+)\s*$', raw_title)
        if _url_m:
            if not report_url:
                report_url = _url_m.group(1)
            title = re.sub(r'[\s→–—â>|<\-]+$', '', raw_title[:_url_m.start()]).strip()
        else:
            title = raw_title

        # Extract action items from the meeting detail response
        # Read.ai wraps detail responses in a "data" key
        detail_raw = detail_map.get(meeting.get("id", ""), {})
        detail = detail_raw.get("data", detail_raw)  # unwrap "data" if present
        raw_actions = (
            detail.get("action_items")
            or (detail.get("summary") or {}).get("action_items")
            or detail_raw.get("action_items")
            or (detail_raw.get("summary") or {}).get("action_items")
            or []
        )
        action_items: List[str] = []
        for item in raw_actions:
            if isinstance(item, str):
                text = item.strip()
            elif isinstance(item, dict):
                text = (item.get("text") or item.get("title") or item.get("action") or "").strip()
            else:
                text = ""
            if text:
                action_items.append(text)

        # Email-only participant match, then title fallback
        matched_partners: set = set()
        for participant in participants:
            p_email = participant.get("email", "") or ""
            m = _match_partner(p_email)
            if m:
                matched_partners.add(m["name"])

        m = _match_partner_by_title(title)
        if m:
            matched_partners.add(m["name"])

        for partner_name in matched_partners:
            matched = next((p for p in PARTNERS if p["name"] == partner_name), None)
            if not matched:
                continue

            key = matched["name"]
            if key not in live:
                live[key] = {"notes": "", "actions": [], "last_meeting": "", "report_url": ""}
            ld = live[key]

            # Keep the most recent meeting date; attach that meeting's report URL
            if mtg_date and (not ld["last_meeting"] or mtg_date > ld["last_meeting"]):
                ld["last_meeting"] = mtg_date
                if report_url:
                    ld["report_url"] = report_url

            # Accumulate meeting title as a note entry
            note_line = f"Meeting: {title} ({mtg_date})"
            if note_line not in ld["notes"]:
                ld["notes"] = note_line + ("\n\n" + ld["notes"] if ld["notes"] else "")

            # Accumulate action items across all meetings (deduplicate case-insensitively)
            for action in action_items:
                if not any(a.lower().strip() == action.lower().strip() for a in ld["actions"]):
                    ld["actions"].append(action)

            # Tally current-week count
            if mtg_dt and mtg_dt >= week_start:
                sbu = matched.get("sbu", "Unassigned") if matched.get("sbu") in week_counts["BD Partner"] else "Unassigned"
                typ = matched["type"] if matched["type"] in week_counts else "Partner"
                week_counts[typ][sbu] += 1

    # Patch current week in WEEKLY
    weekly = copy.deepcopy(WEEKLY)
    for w in weekly:
        if w.get("current"):
            for t in ["BD Partner", "Partner", "SME"]:
                for s in ["US", "India", "MEA", "Global", "Unassigned"]:
                    w["cells"][t][s] = week_counts[t][s]
            break

    state["live_data"] = live
    state["weekly"]    = weekly
    return state


async def fetch_outlook_calendar(state: SyncState) -> SyncState:
    """Pull Myrah's Outlook calendar (last 30 days); match partner meetings by attendee email."""
    token = await _graph_delegated_token()
    if not token:
        state["errors"].append("Outlook not authorized — run outlook_setup.py")
        return state
    if not MYRAH_EMAIL:
        state["errors"].append("MYRAH_EMAIL not configured in .env")
        return state

    headers = {"Authorization": f"Bearer {token}"}
    live: Dict[str, Dict] = state.get("live_data", {})
    now   = datetime.now(timezone.utc)
    since = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    until = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Fast email → partner lookup
    email_to_partner: Dict[str, Dict] = {
        p["email"].lower(): p for p in PARTNERS if p.get("email")
    }
    if not email_to_partner:
        return state

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{GRAPH_BASE}/users/{MYRAH_EMAIL}/calendarView",
                headers=headers,
                params={
                    "startDateTime": since,
                    "endDateTime":   until,
                    "$top":          200,
                    "$select":       "subject,start,end,attendees,organizer",
                },
            )
            if r.status_code != 200:
                state["errors"].append(f"Outlook calendar {r.status_code}: {r.text[:200]}")
                return state
            events = r.json().get("value", [])
    except Exception as e:
        state["errors"].append(f"Outlook calendar fetch: {e}")
        return state

    for event in events:
        subject  = event.get("subject", "")
        start_dt = (event.get("start") or {}).get("dateTime", "")
        mtg_date = start_dt[:10] if start_dt else ""

        # Gather all attendee + organizer emails for this event
        attendees = event.get("attendees") or []
        organizer = (event.get("organizer") or {}).get("emailAddress", {})
        event_emails: set = {
            (a.get("emailAddress") or {}).get("address", "").lower()
            for a in attendees
        }
        if organizer.get("address"):
            event_emails.add(organizer["address"].lower())

        for email in event_emails:
            p = email_to_partner.get(email)
            if not p:
                continue

            key = p["name"]
            if key not in live:
                live[key] = {"notes": "", "actions": [], "last_meeting": "", "report_url": ""}
            ld = live[key]

            # Update last_meeting only if this Outlook event is more recent
            if mtg_date and (not ld["last_meeting"] or mtg_date > ld["last_meeting"]):
                ld["last_meeting"] = mtg_date

            # Add as a note (prefixed so it's distinguishable from Read.ai notes)
            note_line = f"Outlook meeting: {subject} ({mtg_date})"
            if note_line not in ld["notes"]:
                ld["notes"] = note_line + ("\n\n" + ld["notes"] if ld["notes"] else "")

    state["live_data"] = live
    return state


async def finalise(state: SyncState) -> SyncState:
    state["synced_at"] = datetime.now(timezone.utc).isoformat()
    return state

# ── Build graph ───────────────────────────────────────────────────────────────

def build_sync_graph():
    builder = StateGraph(SyncState)
    builder.add_node("fetch_readai_meetings",  fetch_readai_meetings)
    builder.add_node("fetch_meeting_details",  fetch_meeting_details)
    builder.add_node("fetch_outlook_calendar", fetch_outlook_calendar)
    builder.add_node("finalise",               finalise)

    builder.set_entry_point("fetch_readai_meetings")
    builder.add_edge("fetch_readai_meetings",  "fetch_meeting_details")
    builder.add_edge("fetch_meeting_details",  "fetch_outlook_calendar")
    builder.add_edge("fetch_outlook_calendar", "finalise")
    builder.add_edge("finalise", END)

    return builder.compile()


_graph = build_sync_graph()


async def run_sync() -> Dict[str, Any]:
    initial: SyncState = {
        "meetings":  [],
        "live_data": {},
        "weekly":    copy.deepcopy(WEEKLY),
        "errors":    [],
        "synced_at": "",
    }
    return await _graph.ainvoke(initial)

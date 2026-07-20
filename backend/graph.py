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
    meetings: List[Dict]           # cadence meetings (filtered) — details fetched for these
    all_meetings_raw: List[Dict]   # ALL Read.ai meetings — used for meetings_history only
    live_data: Dict[str, Dict]     # keyed by partner name → {notes, actions, last_meeting, …}
    weekly: List[Dict]             # updated WEEKLY rows
    week_counts: Dict[str, Dict[str, int]]
    week_partners: Dict[str, Dict[str, List[str]]]
    week_start_iso: str
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

    # Build first-name uniqueness map once per call (fast — PARTNERS is small)
    first_name_map: Dict[str, list] = {}
    for p in PARTNERS:
        fname = p["name"].split()[0].lower()
        first_name_map.setdefault(fname, []).append(p)

    best = None
    best_score = 0
    title_words = set(clean.split())
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
        if pn_words and all(w in title_words for w in pn_words):
            score = sum(len(w) for w in pn_words)
            if score > best_score:
                best, best_score = p, score

    if best:
        return best

    # Fallback: first-name-only match, but ONLY when that first name is unique across all partners
    for p in PARTNERS:
        fname = p["name"].split()[0].lower()
        if fname in title_words and len(first_name_map.get(fname, [])) == 1:
            return p

    return None

# ── Nodes ────────────────────────────────────────────────────────────────────

def _get_folders(m: dict) -> list:
    """Read.ai uses different field names across API versions."""
    for key in ("folders", "folder", "collections", "collection", "tags", "labels"):
        val = m.get(key)
        if val:
            return [val] if isinstance(val, str) else list(val)
    return []


def _is_partner_meeting(m: dict) -> bool:
    """Match only partner cadence/BD/alignment calls — exclude prospect/client meetings."""
    folder_strs = [str(f).lower() for f in _get_folders(m)]
    FOLDER_KEYWORDS = ("partner", "alignment", "cadence", "planning", "bd ")
    if any(kw in f for f in folder_strs for kw in FOLDER_KEYWORDS):
        return True
    # Title must explicitly signal a partnership meeting — NOT just mention a partner's name
    # (that would match prospect/client meetings where a partner happens to be present)
    title = m.get("title", "").lower()
    TITLE_KEYWORDS = (
        "partner", "cadence", "alignment", "bi-weekly", "biweekly",
        "check-in", "catch-up", "partnership", "planning call",
        "intro call", "intro meeting", "collaboration", "bd call", "bd meeting",
    )
    return any(kw in title for kw in TITLE_KEYWORDS)


async def fetch_readai_meetings(state: SyncState) -> SyncState:
    """Pull ALL Read.ai meetings (paginated); keep partner/alignment calls."""
    token = await _readai_token() or READAI_API_KEY
    if not token:
        state["errors"].append("Read.ai not authorized — run readai_setup.py")
        return state

    headers = {"Authorization": f"Bearer {token}"}
    all_meetings: list = []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Paginate through all meetings
            cursor = None
            while True:
                params: dict = {"page_size": 100}
                if cursor:
                    params["cursor"] = cursor
                r = await client.get(f"{READAI_BASE}/meetings", headers=headers, params=params)
                r.raise_for_status()
                body = r.json()
                page = body.get("data", [])
                all_meetings.extend(page)
                # Stop if fewer results than requested (last page) or no cursor
                next_cursor = (body.get("pagination") or body.get("meta") or {}).get("next_cursor") or body.get("next_cursor")
                if not next_cursor or len(page) < 100:
                    break
                cursor = next_cursor
    except Exception as e:
        state["errors"].append(f"Read.ai list_meetings error: {e}")
        return state

    state["all_meetings_raw"] = all_meetings
    # Cadence-filtered meetings get full detail fetching (action items, notes, weekly counts)
    state["meetings"] = [m for m in all_meetings if _is_partner_meeting(m)]
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
    week_partners: Dict[str, Dict[str, List[str]]] = {
        t: {"US": [], "India": [], "MEA": [], "Global": [], "Unassigned": []}
        for t in ["BD Partner", "Partner", "SME"]
    }

    # Fetch all meeting details in parallel so we can extract action items.
    # Also try /report endpoint — meetings with live_enabled=False store manual
    # notes and actions there rather than in the main detail response.
    async def _fetch_detail(client: httpx.AsyncClient, meeting_id: str) -> Dict:
        if not meeting_id or not headers:
            return {}
        merged: Dict = {}
        for path in (f"{READAI_BASE}/meetings/{meeting_id}", f"{READAI_BASE}/meetings/{meeting_id}/report"):
            try:
                r = await client.get(path, headers=headers)
                if r.status_code == 200:
                    body = r.json()
                    # Unwrap "data" wrapper if present
                    data = body.get("data", body)
                    merged.update({k: v for k, v in data.items() if v})
            except Exception as e:
                state["errors"].append(f"Read.ai {path}: {e}")
        return merged

    async with httpx.AsyncClient(timeout=30) as client:
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

        # Extract action items from merged detail+report response.
        # Read.ai stores actions in several places depending on meeting type.
        detail = detail_map.get(meeting.get("id", ""), {})
        summary_block = detail.get("summary") or {}

        def _extract_items(raw) -> List[str]:
            out = []
            if not raw:
                return out
            if isinstance(raw, str):
                return [raw.strip()] if raw.strip() else []
            for item in raw:
                if isinstance(item, str):
                    t = item.strip()
                elif isinstance(item, dict):
                    t = (item.get("text") or item.get("title") or item.get("action")
                         or item.get("description") or item.get("content") or "").strip()
                else:
                    t = ""
                if t:
                    out.append(t)
            return out

        action_items: List[str] = (
            _extract_items(detail.get("action_items"))
            or _extract_items(summary_block.get("action_items"))
            or _extract_items(detail.get("next_steps"))
            or _extract_items(summary_block.get("next_steps"))
            or _extract_items(detail.get("key_decisions"))
            or _extract_items(summary_block.get("key_decisions"))
        )

        # Extract meeting overview/summary text for notes column
        overview = ""
        for _fld in ("overview", "notes", "summary_text", "description"):
            _v = summary_block.get(_fld) or detail.get(_fld)
            if not _v:
                continue
            if isinstance(_v, list):
                overview = " ".join(
                    (x.get("text") or x.get("content") or str(x)).strip()
                    for x in _v if x
                ).strip()
            else:
                overview = str(_v).strip()
            if overview:
                break
        if not overview:
            pts = summary_block.get("key_points") or []
            if pts and isinstance(pts, list):
                overview = "; ".join(
                    (x.get("text") or x.get("content") or str(x)).strip()
                    for x in pts[:3] if x
                )

        # Match by email, participant name, then meeting title
        matched_partners: set = set()
        for participant in participants:
            p_email = participant.get("email", "") or ""
            m = _match_partner(p_email)
            if m:
                matched_partners.add(m["name"])
            # Also try matching participant display name against known partners
            p_name = participant.get("name", "") or ""
            m2 = _match_partner_by_title(p_name) if p_name else None
            if m2:
                matched_partners.add(m2["name"])

        m = _match_partner_by_title(title)
        if m:
            matched_partners.add(m["name"])

        for partner_name in matched_partners:
            matched = next((p for p in PARTNERS if p["name"] == partner_name), None)
            if not matched:
                continue

            key = matched["name"]
            if key not in live:
                live[key] = {"notes": "", "actions": [], "last_meeting": "", "report_url": "", "meetings_history": []}
            ld = live[key]
            if "meetings_history" not in ld:
                ld["meetings_history"] = []

            # Keep the most recent meeting date; attach that meeting's report URL
            if mtg_date and (not ld["last_meeting"] or mtg_date > ld["last_meeting"]):
                ld["last_meeting"] = mtg_date
                if report_url:
                    ld["report_url"] = report_url

            # Accumulate meeting history (date + report link); deduplicate by date
            existing_hist_dates = {m["date"] for m in ld["meetings_history"]}
            if mtg_date and mtg_date not in existing_hist_dates:
                ld["meetings_history"].append({"date": mtg_date, "url": report_url, "title": title})

            # Richer note: [date] title + overview text
            note_header = f"[{mtg_date}] {title}"
            if note_header not in ld["notes"]:
                note_entry = note_header + (f"\n{overview}" if overview else "")
                ld["notes"] = note_entry + ("\n\n" + ld["notes"] if ld["notes"] else "")

            # Accumulate action items across all meetings (deduplicate case-insensitively)
            for action in action_items:
                if not any(a.lower().strip() == action.lower().strip() for a in ld["actions"]):
                    ld["actions"].append(action)

            # Tally current-week count
            if mtg_dt and mtg_dt >= week_start:
                sbu = matched.get("sbu", "Unassigned") if matched.get("sbu") in week_counts["BD Partner"] else "Unassigned"
                typ = matched["type"] if matched["type"] in week_counts else "Partner"
                week_counts[typ][sbu] += 1
                if partner_name not in week_partners[typ][sbu]:
                    week_partners[typ][sbu].append(partner_name)

    # Second pass: match ALL Read.ai meetings for meetings_history only.
    # Uses email, participant display-name, AND meeting title matching.
    # No detail API calls — only list-level data (title, date, report_url).
    for meeting in state.get("all_meetings_raw", []):
        participants = meeting.get("participants") or []
        start_ms     = meeting.get("start_time_ms", 0)
        mtg_dt       = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc) if start_ms else None
        mtg_date     = mtg_dt.strftime("%Y-%m-%d") if mtg_dt else ""
        report_url   = meeting.get("report_url", "")
        raw_title    = meeting.get("title", "") or ""

        matched_set: set = set()
        # 1. Email match
        for participant in participants:
            p_email = (participant.get("email", "") or "").lower().strip()
            pm = _match_partner(p_email)
            if pm:
                matched_set.add(pm["name"])
            # 2. Participant display-name match (handles "Graham Kitching" or just "Graham")
            p_name = (participant.get("name", "") or "").strip()
            if p_name:
                pm2 = _match_partner_by_title(p_name)
                if pm2:
                    matched_set.add(pm2["name"])
        # 3. Meeting title match (catches "Graham call", "Call with Graham Kitching", etc.)
        tm = _match_partner_by_title(raw_title)
        if tm:
            matched_set.add(tm["name"])

        for partner_name in matched_set:
            # Create a live entry if this partner wasn't matched in the first pass
            if partner_name not in live:
                live[partner_name] = {"notes": "", "actions": [], "last_meeting": "", "report_url": "", "meetings_history": []}
            ld = live[partner_name]
            if "meetings_history" not in ld:
                ld["meetings_history"] = []
            existing_dates = {m["date"] for m in ld["meetings_history"]}
            if mtg_date and mtg_date not in existing_dates:
                ld["meetings_history"].append({"date": mtg_date, "url": report_url, "title": raw_title})
            # Keep last_meeting up to date
            if mtg_date and (not ld.get("last_meeting") or mtg_date > ld["last_meeting"]):
                ld["last_meeting"] = mtg_date
                if report_url and not ld.get("report_url"):
                    ld["report_url"] = report_url

    # Sort each partner's meeting history newest-first, keep last 6
    for _k in live:
        hist = live[_k].get("meetings_history", [])
        hist.sort(key=lambda m: m.get("date", ""), reverse=True)
        live[_k]["meetings_history"] = hist[:6]

    state["live_data"]      = live
    state["week_counts"]    = week_counts
    state["week_partners"]  = week_partners
    state["week_start_iso"] = week_start.isoformat()
    return state


async def fetch_outlook_calendar(state: SyncState) -> SyncState:
    """Pull Myrah's Outlook calendar (last 30 days); match partner meetings by attendee email."""
    _SBUS = ["US", "India", "MEA", "Global", "Unassigned"]
    _TYPES = ["BD Partner", "Partner", "SME"]

    # Retrieve week tracking state from previous node (or initialise defaults)
    week_counts: Dict[str, Dict[str, int]] = state.get(
        "week_counts",
        {t: {s: 0 for s in _SBUS} for t in _TYPES}
    )
    week_partners: Dict[str, Dict[str, List[str]]] = state.get(
        "week_partners",
        {t: {s: [] for s in _SBUS} for t in _TYPES}
    )
    week_start_iso = state.get("week_start_iso", "")
    if week_start_iso:
        week_start = datetime.fromisoformat(week_start_iso).replace(tzinfo=timezone.utc)
    else:
        now_tmp    = datetime.now(timezone.utc)
        week_start = (now_tmp - timedelta(days=now_tmp.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

    def _patch_weekly(wc: Dict, wp: Dict) -> List[Dict]:
        weekly = copy.deepcopy(WEEKLY)
        for w in weekly:
            if w.get("current"):
                if "cell_partners" not in w:
                    w["cell_partners"] = {t: {s: [] for s in _SBUS} for t in _TYPES}
                for t in _TYPES:
                    for s in _SBUS:
                        existing = w["cell_partners"][t][s]
                        new_names = [p for p in wp[t][s] if p not in existing]
                        # Only count partners not already tracked in the baseline
                        w["cells"][t][s] += len(new_names)
                        w["cell_partners"][t][s] = existing + new_names
                break
        return weekly

    token = await _graph_delegated_token()
    if not token:
        state["errors"].append("Outlook not authorized — run outlook_setup.py")
        state["weekly"] = _patch_weekly(week_counts, week_partners)
        return state
    if not MYRAH_EMAIL:
        state["errors"].append("MYRAH_EMAIL not configured in .env")
        state["weekly"] = _patch_weekly(week_counts, week_partners)
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

        counted_partners_this_event: set = set()
        for email in event_emails:
            p = email_to_partner.get(email)
            if not p:
                continue

            key = p["name"]
            if key not in live:
                live[key] = {"notes": "", "actions": [], "last_meeting": "", "report_url": "", "meetings_history": []}
            ld = live[key]
            if "meetings_history" not in ld:
                ld["meetings_history"] = []

            # Update last_meeting only if this Outlook event is more recent
            if mtg_date and (not ld["last_meeting"] or mtg_date > ld["last_meeting"]):
                ld["last_meeting"] = mtg_date

            # Accumulate meeting history
            if mtg_date and mtg_date not in {m["date"] for m in ld["meetings_history"]}:
                ld["meetings_history"].append({"date": mtg_date, "url": "", "title": subject})

            # Add as a note
            note_line = f"[{mtg_date}] {subject}"
            if note_line not in ld["notes"]:
                ld["notes"] = note_line + ("\n\n" + ld["notes"] if ld["notes"] else "")

            # Tally current-week count (each partner counted once per event)
            if start_dt and key not in counted_partners_this_event:
                try:
                    ev_dt = datetime.fromisoformat(start_dt.rstrip("Z") + "+00:00")
                except ValueError:
                    ev_dt = None
                if ev_dt and ev_dt >= week_start:
                    sbu = p.get("sbu", "Unassigned") if p.get("sbu") in week_counts.get("BD Partner", {}) else "Unassigned"
                    typ = p.get("type", "Partner") if p.get("type") in week_counts else "Partner"
                    week_counts[typ][sbu] += 1
                    if key not in week_partners[typ][sbu]:
                        week_partners[typ][sbu].append(key)
                    counted_partners_this_event.add(key)

    # Sort each partner's meeting history newest-first, keep last 6
    for _k in live:
        hist = live[_k].get("meetings_history", [])
        hist.sort(key=lambda m: m.get("date", ""), reverse=True)
        live[_k]["meetings_history"] = hist[:6]

    state["live_data"]   = live
    state["week_counts"] = week_counts
    state["week_partners"] = week_partners
    state["weekly"]      = _patch_weekly(week_counts, week_partners)
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
    _sbus  = ["US", "India", "MEA", "Global", "Unassigned"]
    _types = ["BD Partner", "Partner", "SME"]
    initial: SyncState = {
        "meetings":          [],
        "all_meetings_raw":  [],
        "live_data":         {},
        "weekly":            copy.deepcopy(WEEKLY),
        "week_counts":       {t: {s: 0  for s in _sbus} for t in _types},
        "week_partners":     {t: {s: [] for s in _sbus} for t in _types},
        "week_start_iso":    "",
        "errors":            [],
        "synced_at":         "",
    }
    return await _graph.ainvoke(initial)

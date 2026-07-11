"""
Nepal timezone helpers.

The pilot runs for a single Nepal-based institution, so all business timestamps
and all "today"/"yesterday" comparisons use Asia/Kathmandu (UTC+5:45) consistently.
This avoids the class of bug where a record is stamped in UTC but filtered against a
server-local date (they disagree around midnight and whenever the server runs UTC),
which made recorded collections never appear on the manager's "today" dashboard.
"""
from datetime import datetime, timezone, timedelta

NEPAL_TZ = timezone(timedelta(hours=5, minutes=45))


def now_nepal() -> datetime:
    """Timezone-aware 'now' in Asia/Kathmandu."""
    return datetime.now(NEPAL_TZ)


def now_nepal_iso() -> str:
    """ISO-8601 'now' in Asia/Kathmandu (seconds precision — fits VARCHAR(30) on Postgres)."""
    return now_nepal().isoformat(timespec="seconds")


def today_nepal_str() -> str:
    """Today's date (YYYY-MM-DD) in Asia/Kathmandu — use for 'today' filters."""
    return now_nepal().date().isoformat()


def days_ago_nepal_str(days: int) -> str:
    """Date N days before today (YYYY-MM-DD) in Asia/Kathmandu."""
    return (now_nepal().date() - timedelta(days=days)).isoformat()


def to_nepal_iso(value: str | None) -> str:
    """
    Normalize a client-supplied timestamp to Asia/Kathmandu ISO-8601.

    Devices send `collected_at`/`checked_in_at` in UTC (`...Z`/`+00:00`). Storing that
    verbatim breaks "today" date filters, which compare against the Nepal date. This
    converts any parseable timestamp to Nepal time (preserving the real instant) and
    falls back to Nepal-now when the value is missing or unparseable.
    """
    if not value:
        return now_nepal_iso()
    try:
        s = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(NEPAL_TZ).isoformat(timespec="seconds")
    except (ValueError, TypeError):
        return now_nepal_iso()

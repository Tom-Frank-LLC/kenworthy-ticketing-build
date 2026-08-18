#!/usr/bin/env python3
"""
Rebuild square-venue-dates with real RFC 3339 timestamps, from data already on
disk. Nothing here contacts Square.

Why the timestamps come from showings rather than from the descriptions:

  NT LIVE: THE IMPORTANCE OF BEING EARNEST carries, in Square's own event block,
  start_at = 2025-03-23T19:00:00+00:00. Our showings export holds
  2025-03-23 19:00:00+00 for the same title. Identical. So showings.start_time
  is already in exactly the form Square stores, and using it directly avoids
  inventing a timezone conversion.

  The descriptions, by contrast, give local Pacific wall-clock time and no year
  at all -- BARBIE reads "September 1 at 7 PM" against a stored
  2023-09-02T02:00:00Z. They are still needed to pick WHICH year a repertory
  title belongs to, but not to build the timestamp.

So the description date selects the run; the showings rows supply the instants.

Output: square-venue-dates-v2.csv
"""
import csv, re, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from collections import defaultdict

PACIFIC_TZ = ZoneInfo("America/Los_Angeles")

DL = "/Users/thecommodore/Downloads/"
LISTINGS = DL + "square-venue-dates_1.csv"
SHOWINGS = DL + "kenworthy-showings-export.csv"
OUT = DL + "square-venue-dates-v2.csv"

VENUE_NAME = "Kenworthy Performing Arts Centre"

MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october "
    "november december".split())}

PACIFIC = timedelta(hours=-7)   # only ever used to compare a month/day
RUN_DAYS = 12                   # widest plausible span of one title's run


def parse_full(s):
    """'November 16 at 7:30 PM' -> (month, day, hour, minute)."""
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([AP])M",
                 (s or "").strip(), re.I)
    if not m:
        return None
    mon = MONTHS.get(m.group(1).lower())
    if not mon:
        return None
    hour = int(m.group(3)) % 12
    if m.group(5).upper() == "P":
        hour += 12
    return mon, int(m.group(2)), hour, int(m.group(4) or 0)


def parse_when(s):
    p = parse_full(s)
    return (p[0], p[1]) if p else None


def local_to_utc(year, mon, day, hour, minute):
    """Description times are local Pacific wall-clock.

    Verified: 'September 1 at 7 PM' for BARBIE in 2023 converts to
    2023-09-02T02:00:00+00:00, which is exactly what showings stores.
    """
    try:
        return datetime(year, mon, day, hour, minute, tzinfo=PACIFIC_TZ)
    except ValueError:
        return None


def norm(t):
    t = (t or "").upper()
    t = re.sub(r"^(THE\s+)?MET(ROPOLITAN)?\s*(LIVE|OPERA)?\s*(IN\s*HD)?\s*[:\-]\s*", "", t)
    t = re.sub(r"^NT\s*LIVE\s*[:\-]\s*", "", t)
    t = re.sub(r"^(EXHIBITION\s+ON\s+SCREEN|NATIONAL\s+THEATRE\s+LIVE)\s*[:\-]\s*", "", t)
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^A-Z0-9]+", " ", t)
    t = re.sub(r"\b(THE|A|AN)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def rfc3339(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


# --- showings ---------------------------------------------------------------
by_title = defaultdict(list)
with open(SHOWINGS, newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        raw = (r.get("start_time") or "").strip()
        if not raw:
            continue
        iso = re.sub(r"([+-]\d{2})$", r"\1:00", raw.replace(" ", "T", 1))
        try:
            dt = datetime.fromisoformat(iso)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        for col in ("movie_title", "event_title", "performance_title"):
            if r.get(col):
                by_title[norm(r[col])].append(dt)

# --- listings ---------------------------------------------------------------
rows = list(csv.DictReader(open(LISTINGS, newline="", encoding="utf-8")))
out = []
stats = defaultdict(int)

for r in rows:
    name = r["Item Name"]
    token = r["Square Token"].strip()
    want = parse_when(r.get("Start"))
    cands = sorted(by_title.get(norm(name), []))

    start = end = ""
    source = "none"
    note = ""

    if cands and want:
        mon, day = want
        # Pick the run whose local date sits nearest the description's date.
        def gap(c):
            local = c + PACIFIC
            try:
                return abs((datetime(2000, local.month, local.day)
                            - datetime(2000, mon, day)).days)
            except ValueError:
                return 999
        best = min(cands, key=gap)
        if gap(best) <= 1:
            source = "showings (date confirmed by description)"
        elif gap(best) <= 10:
            source = "showings (nearest run; description date differs)"
            note = f"description said {r['Start']}"
        else:
            best = None
            source = "no run near the description date"
        if best is not None:
            run = [c for c in cands if abs((c - best).days) <= RUN_DAYS]
            start = rfc3339(min(run))

            # The showings export averages ~1.2 rows per title, so it cannot
            # reconstruct a multi-day run on its own. The description can --
            # it is where "Feb 7 -> Feb 9" came from. Take the year from the
            # matched showing and rebuild the end instant from the description.
            end_desc = parse_full(r.get("End"))
            year = min(run).astimezone(PACIFIC_TZ).year
            cand_end = None
            if end_desc:
                cand_end = local_to_utc(year, *end_desc)
            run_end = max(run)
            pick = max([d for d in (cand_end, run_end) if d], default=None)
            end = rfc3339(pick) if pick else ""
            if end == start:
                end = ""
    elif cands and not want:
        # Undated row (NEEDS DESCRIPTION) that nonetheless has showings.
        run = cands
        start, end = rfc3339(min(run)), rfc3339(max(run))
        if start == end:
            end = ""
        source = "showings only (no description date to cross-check)"
    elif want:
        source = "description only — no showing, year unknown"
        note = r["Start"]

    stats[source] += 1
    out.append({
        "Item Name": name,
        "Square Token (variation)": token,
        "Type": r.get("Type", ""),
        "event_location_name": VENUE_NAME,
        "start_at": start,
        "end_at": end,
        "Source": source,
        "Note": note,
    })

with open(OUT, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)

dated = sum(1 for o in out if o["start_at"])
print(f"rows            : {len(out)}")
print(f"with start_at   : {dated}")
print(f"with end_at     : {sum(1 for o in out if o['end_at'])}")
print(f"venue on all    : {sum(1 for o in out if o['event_location_name'])}")
print()
for k, v in sorted(stats.items(), key=lambda x: -x[1]):
    print(f"  {v:4d}  {k}")
print(f"\nwrote {OUT}")

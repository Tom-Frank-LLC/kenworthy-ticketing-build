#!/usr/bin/env python3
"""
Can the missing year be recovered from data we already hold, without Square?

The CSV's Start/End came from production descriptions, which carry a month, a
day and a time but never a year. The showings export carries real UTC
timestamps. So the question is purely one of matching: for each dated listing,
is there a showing whose title matches and whose local month/day matches the
description-parsed date? If yes, that showing supplies the year.

Read-only. Reports coverage; writes nothing.
"""
import csv, re, sys
from datetime import datetime, timedelta, timezone
from collections import defaultdict

DL = "/Users/thecommodore/Downloads/"
LISTINGS = DL + "square-venue-dates_1.csv"
SHOWINGS = DL + "kenworthy-showings-export.csv"

MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october "
    "november december".split())}

# Moscow, Idaho is Pacific. Showing times are stored UTC; -7 in DST, -8 in
# winter. An hour of slop either way does not matter here -- we only use the
# converted value to compare a month and a day, and we accept a +/-1 day window
# anyway, so the exact offset never changes the answer.
PACIFIC = timedelta(hours=-7)


def parse_when(s):
    """'November 16 at 7:30 PM' -> (month, day, hour, minute)."""
    s = (s or "").strip()
    if not s:
        return None
    m = re.match(
        r"([A-Za-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([AP])M",
        s, re.I)
    if not m:
        return None
    mon = MONTHS.get(m.group(1).lower())
    if not mon:
        return None
    hour = int(m.group(3)) % 12
    if m.group(5).upper() == "P":
        hour += 12
    return mon, int(m.group(2)), hour, int(m.group(4) or 0)


def norm(t):
    """Loose title key: drop series prefixes, punctuation, articles, spacing."""
    t = (t or "").upper()
    t = re.sub(r"^(THE\s+)?MET(ROPOLITAN)?\s*(LIVE|OPERA)?\s*(IN\s*HD)?\s*[:\-]\s*", "", t)
    t = re.sub(r"^NT\s*LIVE\s*[:\-]\s*", "", t)
    t = re.sub(r"^(EXHIBITION\s+ON\s+SCREEN|NATIONAL\s+THEATRE\s+LIVE)\s*[:\-]\s*", "", t)
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^A-Z0-9]+", " ", t)
    t = re.sub(r"\b(THE|A|AN)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# --- showings: title -> local datetimes -------------------------------------
by_title = defaultdict(list)
n_show = 0
with open(SHOWINGS, newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        raw = (r.get("start_time") or "").strip()
        if not raw:
            continue
        # Postgres writes "+00"; fromisoformat wants "+00:00".
        iso = raw.replace(" ", "T", 1)
        iso = re.sub(r"([+-]\d{2})$", r"\1:00", iso)
        try:
            dt = datetime.fromisoformat(iso)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(timezone.utc) + PACIFIC
        n_show += 1
        for col in ("movie_title", "event_title", "performance_title"):
            if r.get(col):
                by_title[norm(r[col])].append(local)

# --- listings ---------------------------------------------------------------
rows = list(csv.DictReader(open(LISTINGS, newline="", encoding="utf-8")))
dated = [r for r in rows if (r.get("Start") or "").strip()]

title_hit = day_hit = 0
years = defaultdict(int)
unmatched_title, unmatched_day = [], []

for r in dated:
    key = norm(r["Item Name"])
    cands = by_title.get(key, [])
    if not cands:
        unmatched_title.append(r["Item Name"])
        continue
    title_hit += 1

    want = parse_when(r["Start"])
    if not want:
        unmatched_day.append((r["Item Name"], r["Start"], "unparseable"))
        continue
    mon, day, _, _ = want
    # Accept +/-1 day: descriptions and the stored time can straddle midnight.
    # Same calendar day, or one either side: a late showing stored in UTC can
    # land on the next day, and multi-showing runs start a day out. Compared in
    # a fixed leap year so Feb 29 and month ends cannot raise.
    def near(c):
        try:
            a = datetime(2000, c.month, c.day)
            b = datetime(2000, mon, day)
        except ValueError:
            return False
        return abs((a - b).days) <= 1

    match = [c for c in cands if near(c)]
    if match:
        day_hit += 1
        years[min(m.year for m in match)] += 1
    else:
        unmatched_day.append(
            (r["Item Name"], r["Start"],
             ", ".join(sorted({c.strftime("%Y-%m-%d") for c in cands})[:4])))

print(f"showings rows with a timestamp : {n_show}")
print(f"distinct normalised titles     : {len(by_title)}")
print()
print(f"listings total                 : {len(rows)}")
print(f"listings with a Start          : {len(dated)}")
print(f"  ...title matches a showing   : {title_hit}")
print(f"  ...AND month/day agrees      : {day_hit}  <-- year recoverable")
print()
print("years supplied:", dict(sorted(years.items())))
print()
print(f"no title match ({len(unmatched_title)}):")
for t in unmatched_title[:15]:
    print("   ", t)
print()
print(f"title matched but no date agreement ({len(unmatched_day)}):")
for t, s, c in unmatched_day[:15]:
    print(f"    {t}  | csv={s}  | showings={c}")

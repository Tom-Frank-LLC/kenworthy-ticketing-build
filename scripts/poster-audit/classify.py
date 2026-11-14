"""Classify every wp-rehydrated poster as right / wrong / unverified.

See docs/FINDINGS-wp-poster-mixup.md. Run from a working folder holding:
  all.json            movies/events/live_performances id, title, poster_url, tbl, is_active
  hashes.json         {id: {sha, size, err}} for each downloaded current poster
  img/<tbl>-<id>      the current poster bytes
  wb/<id>             the original WordPress thumbnail from web.archive.org
  audit_changes.json  admin_audit_log rows whose details.changes has poster_url
  audit_create.json   *.create audit rows (entity_id, orig poster_url, title)
Output: poster-audit.csv. Its verdicts UNDERCOUNT, so review by eye after it.

Evidence, strongest first:
  1. wayback: the listing's original WordPress thumbnail (exact URL from the
     audit log) compared to the current stored image by perceptual hash.
  2. aspect: the thumbnail filename's -WxH gives the original's shape; a
     current image whose shape differs by more than rounding is another image.
  3. shared: the same bytes stored for listings with different titles.
"""
import json, re, os, collections, csv
from PIL import Image
import numpy as np

a = json.load(open('audit_changes.json')); a = a['rows'] if isinstance(a, dict) else a
allr = json.load(open('all.json')); allr = allr['rows'] if isinstance(allr, dict) else allr
hashes = json.load(open('hashes.json'))
cur = {x['id']: x for x in allr}

last = {}
for x in a:
    if x['new'] and 'wp-rehydrated' in x['new']:
        last[x['entity_id']] = x

def dhash(img, n=16):
    g = img.convert('L').resize((n + 1, n), Image.LANCZOS)
    p = np.asarray(g, dtype=np.int16)
    return (p[:, 1:] > p[:, :-1]).flatten()

def load(p):
    try:
        im = Image.open(p); im.load(); return im
    except Exception:
        return None

shared = collections.defaultdict(list)
for x in allr:
    h = hashes.get(x['id'], {}).get('sha')
    if h: shared[h].append(x['id'])

out = []
for eid, ch in last.items():
    row = cur.get(eid)
    if not row:
        continue  # listing deleted since
    still = row['poster_url'] == ch['new']
    m = re.search(r'-(\d+)x(\d+)\.\w+$', ch['old'])
    tw, th = int(m.group(1)), int(m.group(2))
    curimg = load(f"img/{row['tbl']}-{eid}")
    verdict, why, dist = 'unverified', '', None
    if not still:
        verdict, why = 'changed-since', 'poster replaced after rehydration'
    elif curimg is None:
        verdict, why = 'unverified', 'current image unreadable'
    else:
        cw, chh = curimg.size
        # thumbnail is the original scaled to fit; derive the expected other side
        exp_h = cw * th / tw
        aspect_off = abs(exp_h - chh) / chh
        wb = load(f'wb/{eid}')
        if wb is not None:
            d = int((dhash(wb) != dhash(curimg)).sum())
            dist = d
            verdict = 'right' if d <= 40 else 'wrong'
            why = f'wayback dhash {d}/256'
        elif aspect_off > 0.03:
            verdict, why = 'wrong', f'shape {cw}x{chh} vs thumbnail {tw}x{th}'
        else:
            sh = shared.get(hashes[eid]['sha'], [])
            if len(sh) > 1:
                verdict, why = 'suspect', f'image shared with {len(sh)-1} other listing(s)'
            else:
                verdict, why = 'unverified', 'no archive; shape consistent'
    out.append(dict(table=row['tbl'], id=eid, title=row['title'], active=row['is_active'],
                    verdict=verdict, why=why, original=ch['old'], current=row['poster_url']))

# Pass 2: identical bytes as a verified-right listing, but a different original
# thumbnail, means this listing got that listing's picture.
byid = {o['id']: o for o in out}
for h, ids in shared.items():
    rights = [byid[i] for i in ids if i in byid and byid[i]['verdict'] == 'right']
    if not rights: continue
    for i in ids:
        o = byid.get(i)
        if not o or o['verdict'] in ('right', 'changed-since'): continue
        if any(o['original'] == r['original'] for r in rights):
            o['verdict'], o['why'] = 'right', 'same original as a verified listing'
        else:
            o['verdict'], o['why'] = 'wrong', f"has the picture of: {rights[0]['title']}"

# Pass 2b: shared bytes where every listing had the same original thumbnail is a
# deliberate shared poster (a series, a sing-along twin), not a mix-up.
for h, ids in shared.items():
    os_ = [byid[i] for i in ids if i in byid]
    if len(os_) > 1 and len({o['original'].lower() for o in os_}) == 1:
        for o in os_:
            if o['verdict'] == 'suspect': o['verdict'], o['why'] = 'right', 'series shares one original poster'

# Pass 3: for what is still unverified, did another listing's original share this
# file's base name (the WordPress overwrite needs two uploads with one name)?
c = json.load(open('audit_create.json')); c = c['rows'] if isinstance(c, dict) else c
base = lambda u: re.sub(r'-\d+x\d+(\.\w+)$', r'\1', u or '').lower().split('/uploads/')[-1]
names = collections.defaultdict(set)
for x in c:
    if x['orig'] and 'kenworthy.org' in x['orig']: names[base(x['orig'])].add(x['orig'].lower())
for o in out:
    if o['verdict'] in ('unverified', 'suspect'):
        others = names[base(o['original'])] - {o['original'].lower()}
        if others:
            o['verdict'] = 'suspect'
            o['why'] += f'; base name {base(o["original"])} also used by {len(others)} other original(s)'

with open('poster-audit.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
print(collections.Counter(o['verdict'] for o in out))

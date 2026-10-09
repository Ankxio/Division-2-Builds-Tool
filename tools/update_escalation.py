"""Updates the Escalation rotation: this week's missions, today's target loot and the vendor caches.

Ubisoft does not publish the rotation anywhere outside the game. The community site
ProtoTrack.gg records it by hand every day, so this reads ProtoTrack's public Target Loot
page and writes:

  data/escalation.json           what is on today
  data/escalation_history.json   every day seen so far, for "appearances" and "last seen"

The history is built up by this site itself, one day at a time, from the day the job first ran.
If the page cannot be read or stops making sense, the existing files are kept.
"""
import datetime as dt, html, json, os, re, sys, urllib.request

SOURCE = 'https://prototrack.gg/target-loot/target-loot.php'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = os.path.join(ROOT, 'data', 'escalation.json')
HISTORY = os.path.join(ROOT, 'data', 'escalation_history.json')


def text(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def read(page):
    """The rotation on the page, or None if the page does not look like the Target Loot page."""
    dates = re.findall(r'<time datetime="(\d{4}-\d{2}-\d{2})"', page)
    if len(dates) < 3:
        return None
    missions = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        mission = re.search(r'class="tl-mission">(.*?)</div>', row, re.S)
        loot = re.search(r'class="tl-loot">(.*?)</div>', row, re.S)
        if mission and loot:
            faction = re.search(r'alt="([^"]*?)\s*faction"', mission[1])
            missions.append({'mission': text(mission[1]), 'faction': html.unescape(faction[1]) if faction else '', 'loot': text(loot[1])})
    caches = []
    for card in re.findall(r'<article class="tl-vendor-card"[^>]*>(.*?)</article>', page, re.S):
        kind = re.search(r'class="tl-cache-type">(.*?)</span>', card, re.S)
        item = re.search(r'class="tl-loot">(.*?)</div>', card, re.S)
        if kind and item:
            caches.append({'type': text(kind[1]), 'item': text(item[1])})
    if not 3 <= len(missions) <= 12 or any(not m['mission'] or not m['loot'] for m in missions):
        return None
    return {'date': dates[0], 'week': [dates[1], dates[2]], 'missions': missions, 'caches': caches}


def load(path, fallback):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def save(path, data):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def main():
    request = urllib.request.Request(SOURCE, headers={'User-Agent': 'division2-build-planner rotation updater (github.com/Ankxio/Division-2-Builds-Tool)'})
    with urllib.request.urlopen(request, timeout=30) as response:
        now = read(response.read().decode('utf-8', 'replace'))
    if not now:
        sys.exit('The Target Loot page could not be understood; keeping the existing files.')

    history = load(HISTORY, {})
    history[now['date']] = {'week': now['week'][0], 'missions': {m['mission']: m['loot'] for m in now['missions']},
                            'caches': {c['type']: c['item'] for c in now['caches']}}
    history = dict(sorted(history.items()))

    # How often each loot has been on, and when it was last on before today, from our own record.
    today = dt.date.fromisoformat(now['date'])

    def seen(kind, value):
        days = [d for d, day in history.items() if value in day[kind].values()]
        before = [d for d in days if d < now['date']]
        return {'appearances': len(days), 'last_seen_days': (today - dt.date.fromisoformat(before[-1])).days if before else None}

    for m in now['missions']:
        m.update(seen('missions', m['loot']))
    for c in now['caches']:
        c.update(seen('caches', c['item']))
    now['tracked_since'] = next(iter(history))

    old = load(TODAY, {})
    # "updated" only moves when the rotation itself changed, so an unchanged day is not saved again.
    same = {k: old.get(k) for k in now} == now
    now['updated'] = old.get('updated') if same and old.get('updated') else dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    save(TODAY, now)
    save(HISTORY, history)
    print(f"{now['date']}: {len(now['missions'])} missions, {len(now['caches'])} caches, {len(history)} days on record")
    for m in now['missions']:
        print(f"  {m['mission']}: {m['loot']}".encode('ascii', 'replace').decode())


if __name__ == '__main__':
    main()

"""Updates the calendar by itself. GitHub runs this every hour (.github/workflows/update-calendar.yml).

It reads Ubisoft's announcements for The Division 2 from Steam's public news feed and writes:

  data/news.json         the latest announcements, shown as "Latest from Ubisoft"
  data/auto_events.csv   events it could date from those announcements

Only what an announcement states is used: an event is created when the title or text gives
real dates ("coming on November 3", "from October 6 to October 13"). Rows you write yourself
in data/events.csv always win over an automatic row with the same name.
"""
import csv, datetime as dt, html, json, os, re, sys, urllib.request

APP_ID = 2221490  # Tom Clancy's The Division 2 on Steam
FEED = f'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={APP_ID}&count=60&maxlength=0&format=json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONTHS = {m.lower(): i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
MONTH = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?'
DATE = rf'({MONTH})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?'
RANGE = re.compile(rf'{DATE}\s*(?:-|–|—|to|until|through|till)\s*(?:{DATE}|(\d{{1,2}})(?:st|nd|rd|th)?)', re.I)
COMING = re.compile(rf'(?:coming|arrives?|launch(?:es|ing)?|starts?|begins?|available|out|live)\s+(?:on\s+)?{DATE}', re.I)


def plain(text):
    """Steam markup and HTML -> plain text."""
    text = re.sub(r'\[/?[^\]]{1,600}\]', ' ', text or '')
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\{STEAM_CLAN_IMAGE\}\S+', ' ', text)
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()


def month_number(word):
    key = word.lower().rstrip('.')[:3]
    return next(n for name, n in MONTHS.items() if name.startswith(key))


def on(month, day, year, near):
    """A date from "November 3". With no year given, the one closest to the announcement."""
    m, d = month_number(month), int(day)
    try:
        if year:
            return dt.date(int(year), m, d)
        options = [dt.date(near.year + k, m, d) for k in (-1, 0, 1)]
        return min(options, key=lambda x: abs((x - near).days))
    except ValueError:
        return None


def clean_title(title):
    title = re.sub(r'^\s*\[[^\]]+\]\s*', '', title)                       # "[TUY8S3.1] ..."
    title = re.sub(r'^(Tom Clancy.s )?The Division 2\s*[:\-–]\s*', '', title, flags=re.I)
    return title.strip()


def events_from(item):
    """The dated events one announcement states, as (name, start, end, note)."""
    posted = dt.datetime.fromtimestamp(item['date'], dt.timezone.utc).date()
    title, text = item['title'], plain(item.get('contents'))
    name = clean_title(title)
    found = []

    coming = COMING.search(title)
    if coming:
        start = on(coming[1], coming[2], coming[3], posted)
        if start:
            short = re.sub(rf'\s*(?:is\s+)?{COMING.pattern}.*$', '', name, flags=re.I).strip(' -:') or name
            found.append((short, start, None, 'Start date from the announcement title.'))

    # A date range in the text, kept only when it sits near the start: further down an
    # article, ranges tend to be about something other than the headline.
    for m in RANGE.finditer(text[:1500]):
        start = on(m[1], m[2], m[3], posted)
        end = on(m[4], m[5], m[6], posted) if m[4] else on(m[1], m[7], m[3], posted)
        if start and end and dt.timedelta(0) < end - start <= dt.timedelta(days=120):
            if not any(f[0] == name or f[1] == start for f in found):
                found.append((name, start, end, 'Dates read from the announcement text.'))
            break
    return found


def season_for(day, seasons):
    started = [s for s in seasons if s['start'] and s['start'] <= day.isoformat()]
    # Before the first season with a known start date there is no season to file it under.
    return max(started, key=lambda s: s['start'])['id'] if started else ''


def main():
    request = urllib.request.Request(FEED, headers={'User-Agent': 'division2-build-planner calendar updater'})
    with urllib.request.urlopen(request, timeout=30) as response:
        items = json.load(response)['appnews']['newsitems']
    # Ubisoft's own posts only; the feed also carries press articles.
    official = [i for i in items if i.get('feedname') == 'steam_community_announcements']
    if not official:
        sys.exit('The feed returned no official announcements; keeping the existing files.')

    with open(os.path.join(ROOT, 'data', 'seasons.csv'), encoding='utf-8-sig', newline='') as f:
        seasons = list(csv.DictReader(f))

    news = [{
        'title': i['title'], 'url': i['url'],
        'date': dt.datetime.fromtimestamp(i['date'], dt.timezone.utc).strftime('%Y-%m-%d'),
        'summary': plain(i.get('contents'))[:220],
    } for i in official[:20]]

    rows, seen = [], set()
    today = dt.datetime.now(dt.timezone.utc).date()
    for item in official:
        for name, start, end, note in events_from(item):
            key = re.sub(r'[^a-z0-9]', '', name.lower())
            # Long-finished events are left out: the calendar is about now and what is next.
            if key in seen or (end or start) < today - dt.timedelta(days=60):
                continue
            seen.add(key)
            rows.append({
                'season': season_for(start, seasons), 'category': 'Announced', 'name': name,
                'detail': 'From an official announcement', 'start': start.isoformat(),
                'end': end.isoformat() if end else '', 'note': note, 'url': item['url'],
            })

    with open(os.path.join(ROOT, 'data', 'news.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'items': news}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    with open(os.path.join(ROOT, 'data', 'auto_events.csv'), 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, ['season', 'category', 'name', 'detail', 'start', 'end', 'note', 'url'], lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    print(f'{len(news)} announcements, {len(rows)} dated events')
    for r in rows:
        print(f"  {r['start']} -> {r['end'] or '?'}  {r['name']}")


if __name__ == '__main__':
    main()

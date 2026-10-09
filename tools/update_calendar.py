"""Updates the calendar by itself. GitHub runs this every hour (.github/workflows/update-calendar.yml).

It reads Ubisoft's announcements for The Division 2 from Steam's public news feed and writes:

  data/news.json         the latest announcements, shown as "Latest from Ubisoft"
  data/auto_events.csv   every event it could date from those announcements, past and coming

Only what an announcement states is used: an event is created when the title or text gives
real dates ("coming on November 3", "Deadeye Overdrive runs September 29 - October 6"). Rows
you write yourself in data/events.csv win over an automatic row with the same name in the
same season.

It also notices a new season: the long launch article Ubisoft posts for each one ("The
Division 2: Red Horizon") adds a row to data/seasons.csv, so nothing has to be done by hand.
"""
import csv, datetime as dt, html, json, os, re, sys, urllib.request

APP_ID = 2221490  # Tom Clancy's The Division 2 on Steam
FEED = f'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={APP_ID}&count=2000&maxlength=0&format=json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONTHS = {m.lower(): i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
MONTH = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?'
DATE = rf'\b({MONTH})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?'
BETWEEN = r'(?:-|–|—|to|until|through|till|and\s+(?:ends|runs|running)\s+(?:on|until|through)|and)'
RANGE = re.compile(rf'{DATE}\s*,?\s*{BETWEEN}\s*(?:{DATE}|(\d{{1,2}})(?:st|nd|rd|th)?)', re.I)
COMING = re.compile(rf'(?:coming|arrives?|launch(?:es|ing)?|starts?|begins?|available|out|live)\s+(?:on\s+)?{DATE}', re.I)

# "McMillan Reservoir Assault launches on July 21": one date, no end.
SINGLE = re.compile(rf'\b(?:starts?|launch(?:es)?|begins?|opens?|unlocks?|becomes\s+available|arrives?|returns?)\s+(?:on\s+)?{DATE}', re.I)
SEASON_TITLE = re.compile(r'^(?:Year\s+\d+\s+Season\s+\d+\s*[:–-]\s*)?(.{3,40})$', re.I)

# Words that lead into a date range ("... runs from", "... will be available from") and are
# not part of the event's name.
LEAD = re.compile(r"(?:[\s,:(–—\u00b6-]+|\b(?:which|that|will|be|is|are|was|has|have|runs?|running|returns?|returning"
                  r"|live|available|active|starts?|starting|begins?|begun|officially|opens?|from|between|on|tune in"
                  r"|log in|event dates|event period|dates|period|now|again|for a limited time|in the division 2)\b)$", re.I)
JOINERS = {'of', 'the', 'for', 'x', 'a', 'and', 'by', 'in', 'to', 'into', '&', '–', '-'}
# Names that say nothing without the announcement they came from.
GENERIC = {'event', 'eventpass', 'projectchain', 'twitchdrops', 'globalevent', 'projectschain', 'drops', 'contest'}
NOT_A_NAME = {'compensation', 'summary', 'note', 'other', 'rewards', 'wave', 'week', 'howtojoin', 'howitworks', 'patchnotes'}
PATCH_NOTES = re.compile(r'title update|^\[?TU|^update\b', re.I)
CATEGORIES = [
    (r'climax mission', 'Mission'), (r'classified assignment', 'Classified Assignment'),
    (r'twitch|drops', 'Twitch Drops'), (r'event pass', 'Event Pass'), (r'stretch goals|season pass', 'Season Pass'),
    (r'overdrive|stats? multiplier', 'Stat Bonus'), (r'surge|\bxp\b|boost|resource multiplier', 'Resource Bonus'),
    (r'global event|rage harvest|reanimated|ambush|assault|corrosive shell|golden bullet|shd exposed', 'Global Event'),
    (r'project', 'Project Chain'), (r'collab| x ', 'Collaboration'),
    (r'contest|sweepstake', 'Contest'), (r'incursion|raid', 'Incursion'),
]


BREAK = '\u00b6'  # marks where a heading, paragraph or list item ended


def plain(text, breaks=False):
    """Steam markup and HTML -> plain text. With breaks, line ends are kept as a mark."""
    text = text or ''
    if breaks:
        text = re.sub(r'\[/?(?:p|h\d|\*|list|olist|hr|tr|td|th|table)\b[^\]]*\]|\n|<br\s*/?>|</?(?:p|li|h\d|ul|ol|div)\b[^>]*>',
                      f' {BREAK} ', text, flags=re.I)
    text = re.sub(r'\[/?[^\]]{1,600}\]', ' ', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\{STEAM_CLAN_IMAGE\}\S+', ' ', text)
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()


def squash(name):
    return re.sub(r'^the', '', re.sub(r'[^a-z0-9]', '', name.lower()))


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
    return re.sub(r'\s+', ' ', title).strip()


def shouting(word):
    letters = re.sub(r'[^A-Za-z]', '', word)
    return len(letters) >= 2 and letters.isupper()


def tidy(words):
    """A run of words -> a name: no leading "The", headings out of capitals."""
    while words and words[0].lower().strip(':') in (JOINERS - {'into'}) | NOT_A_NAME | {'new', 'our'}:
        words = words[1:]
    while words and words[-1].lower() in JOINERS:
        words = words[:-1]
    if words and all(shouting(w) or w.lower() in JOINERS or not re.search('[a-z]', w) for w in words):
        words = [w if re.search(r'\d', w) else w.lower() if w.lower() in JOINERS else w.capitalize() for w in words]
    return ' '.join(words).strip(' ,:;.!"“”()')


def name_before(before):
    """The event named right before a date range: "Deadeye Overdrive Runs", "RAGE HARVEST From"."""
    while True:
        cut = LEAD.sub('', before)
        if cut == before:
            break
        before = cut
    words, picked = before.split(), []
    heading = bool(words) and shouting(words[-1]) and len(words[-1]) >= 4
    for word in reversed(words):
        if word == BREAK or re.search(r'[.!?;:]$', word) or len(picked) >= 8:
            break
        if heading:
            if not (shouting(word) or word.lower() in JOINERS):
                break
        elif not (word[0].isupper() or word[0].isdigit() or word.lower() in JOINERS or re.fullmatch(r'x\d+', word)) or (shouting(word) and len(word) >= 4):
            break
        picked.insert(0, word)
    return tidy(picked)


def heading_before(before):
    """The nearest heading in capitals above a date range."""
    for line in reversed(before.split(BREAK)[:-1]):
        words = line.split()
        if words and len(words) <= 8 and all(shouting(w) or w.lower() in JOINERS or not re.search('[A-Za-z]', w) for w in words) \
                and any(len(w) >= 4 for w in words):
            return tidy(words)
    return ''


def category_of(name, around):
    for where in (name, around):
        for pattern, label in CATEGORIES:
            if re.search(pattern, where, re.I):
                return label
    return 'Event'


def events_from(item):
    """The dated events one announcement states, as (name, start, end, note, category, own name)."""
    posted = dt.datetime.fromtimestamp(item['date'], dt.timezone.utc).date()
    title, text = item['title'], plain(item.get('contents'), breaks=True)
    article = clean_title(title)
    found = []

    coming = COMING.search(title)
    if coming:
        start = on(coming[1], coming[2], coming[3], posted)
        if start:
            short = re.sub(rf'\s*(?:is\s+)?{COMING.pattern}.*$', '', article, flags=re.I).strip(' -:') or article
            found.append((short, start, None, 'Start date from the announcement title.', 'Announced', True))

    floor = 0  # where the previous range ended: a name is never looked for further back than that
    for m in RANGE.finditer(text):
        start = on(m[1], m[2], m[3], posted)
        end = on(m[4], m[5], m[6], posted) if m[4] else on(m[1], m[7], m[3], posted)
        before, floor = text[max(floor, m.start() - 400):m.start()], m.end()
        if not (start and end and dt.timedelta(0) < end - start <= dt.timedelta(days=120)):
            continue
        own = True  # the range has a name of its own, rather than one borrowed from a heading
        after = re.match(rf"\s*:\s*((?:(?!{MONTH}\s)[A-Z0-9][\w’'&-]*\s+){{1,6}})", text[m.end():])
        if after:  # "July 21-28: National Bond Armory"
            name, floor = tidy(after[1].split()), m.end() + after.end()
        else:
            name = name_before(before[-160:])
            if not name:  # "From September 8 to September 15, Retaliation Surge will be ..."
                after = re.match(r"\s*,\s*((?:[A-Z][\w’'&-]*\s+){2,6})", text[m.end():])
                name = tidy(after[1].split()) if after else ''
        key = re.sub(r'\d', '', squash(name))
        if key in GENERIC or key in NOT_A_NAME or len(key) < 4:
            above, own = heading_before(before), False
            if above and squash(above) not in GENERIC | NOT_A_NAME:
                name = above
            elif key in GENERIC and not PATCH_NOTES.search(article):
                name = f'{article}: {name}'
            elif m.start() < 1500 and not PATCH_NOTES.search(article):
                # Near the top of an article, a range with no name of its own is about the headline.
                name = article
            else:
                continue
            # A nameless range inside one already found is a detail of it (a reward week, a raffle).
            if any(f[2] and f[1] <= start and end <= f[2] and (f[1], f[2]) != (start, end) for f in found):
                continue
        name = re.sub(r'\s+[–—-]\s+.*$', '', name)  # "Tech Overdrive – Stats Multiplier Event"
        key = squash(name)
        if any(f[1] == start and f[2] in (None, end) and (key in squash(f[0]) or squash(f[0]) in key) for f in found):
            continue
        around = before[-120:]
        found.append((name, start, end, 'Dates read from the announcement text.', category_of(name, around), own))

    ranges = [m.span() for m in RANGE.finditer(text)]
    for m in SINGLE.finditer(text):
        start = on(m[1], m[2], m[3], posted)
        if not start or any(a <= m.end() and m.start() <= b for a, b in ranges):
            continue
        before = text[max(0, m.start() - 160):m.start()]
        full = name_before(before)
        name = re.sub(r'^.*,\s*(?=\S+\s+\S)', '', re.sub(r'\s+[–—-]\s+.*$', '', full))  # "Classified Assignment, McMillan ..."
        key = re.sub(r'\d', '', squash(name))
        if key in GENERIC or key in NOT_A_NAME or len(key) < 6 or len(name.split()) < 2:
            continue
        if any(f[1] == start and (key in squash(f[0]) or squash(f[0]) in key) for f in found):
            continue
        found.append((name, start, None, 'Start date read from the announcement text.', category_of(full, before[-120:]), True))
    return found


def new_seasons(official, seasons):
    """Seasons that started after the last one in seasons.csv, found from their launch articles.

    Ubisoft posts one long article per season, titled with the season's name, the afternoon
    before it starts. The season's number comes from the first patch notes that follow
    ("[TUY8S4.1]"), from a "Year 8 Season 4" in the text, or else from counting on by one.
    """
    known = sorted((s for s in seasons if s['start']), key=lambda s: s['start'])
    if not known:
        return []
    added = []
    for item in sorted(official, key=lambda i: i['date']):
        posted = dt.datetime.fromtimestamp(item['date'], dt.timezone.utc).date()
        last = (known + added)[-1]
        title = SEASON_TITLE.match(clean_title(item['title']))
        text = plain(item.get('contents'))
        if posted < dt.date.fromisoformat(last['start']) + dt.timedelta(days=45) or not title or len(text) < 9000:
            continue
        name = title[1].strip()
        if PATCH_NOTES.search(item['title']) or len(name.split()) > 4 or re.search(r'gamescom|recap|event|showcase|dlc|\bx\b', name, re.I):
            continue
        # When it starts: a stated date if any announcement gives one, else the day after the article.
        start = posted + dt.timedelta(days=1)
        for other in official:
            said = re.search(rf'{re.escape(name)}\s+(?:launches|arrives|starts|begins|is\s+coming)\s+(?:on\s+)?{DATE}', plain(other.get('contents')), re.I)
            if said and abs(other['date'] - item['date']) < 40 * 86400:
                start = on(said[1], said[2], said[3], posted) or start
                break
        tag = re.match(r'\s*Year\s+(\d+)\s+Season\s+(\d+)', item['title'], re.I)
        tag = tag or next((m for i in sorted(official, key=lambda i: i['date']) if i['date'] >= item['date']
                           for m in [re.search(r'Y(\d+)S(\d+)\.\d', i['title'])] if m), None)
        tag = tag or re.search(rf'Year\s+(\d+)\s+Season\s+(\d+)\s*[:–-]\s*{re.escape(name)}', item['title'] + ' ' + text, re.I)
        before = re.match(r'Y(\d+)S(\d+)', last['id'])
        if tag:
            year, number = tag[1], tag[2]
        elif before:
            year, number = before[1], int(before[2]) + 1
        else:
            continue
        season = {'id': f'Y{year}S{number}', 'year': str(year), 'name': name, 'start': start.isoformat(), 'end': ''}
        if any(s['id'] == season['id'] for s in seasons + added):
            continue
        added.append(season)
    return added


def season_for(day, seasons):
    started = [s for s in seasons if s['start'] and s['start'] <= day.isoformat()]
    # Before the first season with a known start date there is no season to file it under.
    return max(started, key=lambda s: s['start'])['id'] if started else ''


def main():
    request = urllib.request.Request(FEED, headers={'User-Agent': 'division2-build-planner calendar updater'})
    with urllib.request.urlopen(request, timeout=60) as response:
        items = json.load(response)['appnews']['newsitems']
    # Ubisoft's own posts only; the feed also carries press articles.
    official = [i for i in items if i.get('feedname') == 'steam_community_announcements']
    if not official:
        sys.exit('The feed returned no official announcements; keeping the existing files.')

    with open(os.path.join(ROOT, 'data', 'seasons.csv'), encoding='utf-8-sig', newline='') as f:
        seasons = list(csv.DictReader(f))
    fresh = new_seasons(official, seasons)
    if fresh:
        seasons = fresh[::-1] + seasons
        # Each season ends when the next one starts.
        by_start = sorted((s for s in seasons if s['start']), key=lambda s: s['start'])
        for earlier, later in zip(by_start, by_start[1:]):
            earlier['end'] = earlier['end'] or later['start']
        with open(os.path.join(ROOT, 'data', 'seasons.csv'), 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, ['id', 'year', 'name', 'start', 'end'], lineterminator='\n')
            writer.writeheader()
            writer.writerows(seasons)
        for s in fresh:
            print(f"New season: {s['id']} {s['name']} from {s['start']}")

    news = [{
        'title': i['title'], 'url': i['url'],
        'date': dt.datetime.fromtimestamp(i['date'], dt.timezone.utc).strftime('%Y-%m-%d'),
        'summary': plain(i.get('contents'))[:220],
    } for i in official[:20]]

    # The whole history is read every time, so past events stay on the calendar.
    rows, keys = [], []
    for item in official:
        for name, start, end, note, category, own in events_from(item):
            key, first, last = squash(name), start.isoformat(), end.isoformat() if end else ''
            if any(squash(s['name']) == key for s in seasons):  # the season itself is not an event
                continue
            # A range named after a heading that starts with a longer event is a part of that event.
            if not own and any(r['start'] == first and r['end'] > last for r in rows):
                continue
            # The same event is often announced twice: in its own article and in the patch notes.
            twin = next((r for r, k in zip(rows, keys) if r['start'] == first and (key in k or k in key)
                         and (not last or not r['end'] or r['end'] in (last, 'permanent'))), None)
            if twin:
                if last and not twin['end']:  # the other announcement gave the end date too
                    twin['end'] = last
                continue
            # Missions stay once they unlock.
            if not last and category in ('Classified Assignment', 'Incursion') or (not last and re.search(r'mission|assignment', name, re.I)):
                last = 'permanent'
            keys.append(key)
            rows.append({
                'season': season_for(start, seasons), 'category': category, 'name': name,
                'detail': 'From an official announcement', 'start': first, 'end': last,
                'note': note, 'url': item['url'],
            })
    rows.sort(key=lambda r: r['start'], reverse=True)

    with open(os.path.join(ROOT, 'data', 'news.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'items': news}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    with open(os.path.join(ROOT, 'data', 'auto_events.csv'), 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, ['season', 'category', 'name', 'detail', 'start', 'end', 'note', 'url'], lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    print(f'{len(news)} announcements, {len(rows)} dated events')
    for r in rows:
        print(f"  {r['start']} -> {r['end'] or '?'}  {r['name']}".encode('ascii', 'replace').decode())


if __name__ == '__main__':
    main()

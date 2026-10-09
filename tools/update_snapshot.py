"""Refreshes data/snapshot/ with the current contents of the community gear sheet.

The site reads the sheet live on every visit, so this only keeps the offline copy (what the
site shows first, and falls back to) current. GitHub runs it with the calendar job.
Keep the sheet ID and tab list in step with js/config.js and js/sheet.js.
"""
import os, urllib.request

SHEET = '1nrPBmOrtpkEW1j5fbcRT7L-AXgsGOqMqxXoVtopsiGM'
TABS = {
    'welcome': '1380412817', 'weapons': '0', 'weapons_named': '1574559653', 'weapon_talents': '89782728',
    'gearsets': '1925112187', 'brandsets': '1006013297', 'gear_named': '195186127', 'gear_talents': '1724618107',
    'skill_list': '2053261857', 'attribute_info': '412070318', 'weapon_mods': '1283569496',
}
TARGET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'snapshot')

for name, gid in TABS.items():
    path = os.path.join(TARGET, f'{name}.csv')
    try:
        url = f'https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv&gid={gid}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60) as response:
            data = response.read()
        old = os.path.getsize(path) if os.path.exists(path) else 0
        # A sign-in page or a tab that lost most of its rows is not the sheet: keep the old copy.
        if data.lstrip()[:1] == b'<' or len(data) < max(200, old * 0.5):
            raise ValueError('the download does not look like the sheet')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'{name:<16} ok ({len(data):,} bytes)')
    except Exception as error:  # one tab failing must not stop the others
        print(f'{name:<16} kept the old copy: {error}')

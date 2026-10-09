# Division 2 Build Planner

A build planner for The Division 2 with every weapon, brand, gear set, named and exotic item,
talent, mod and skill. Pick a loadout and see set bonuses, damage, DPS, a damage-over-time
chart, time to kill and skill numbers. Every build has its own link to share.

It is plain HTML, CSS and JavaScript. There is nothing to install or build.

## Where the game data comes from

The site reads the community **Division 2 Gear Spreadsheet** (by Azurmen, Bend3n,
Gingerbeard_x, Maplestruck and Saint Landwalker) directly, every time someone opens it.
When the sheet's authors add a weapon or change a number after a patch, the site shows it on
the next visit with no work from you.

- The chip in the header says **Live data** when the sheet was read, with the patch and date
  the sheet reports.
- If the sheet cannot be reached, or a tab stops making sense, the site uses the copy in
  `data/snapshot/` instead and the chip says **Offline copy**. One broken tab falls back on
  its own; the rest stay live.
- `js/sheet.js` is the importer. It finds columns by their header text, so columns can move
  without breaking it.

To refresh the offline copy, run `tools\update-snapshot.ps1` and upload the changed files.

To point the site at a different sheet (for example your own copy), change `sheetId` in
`js/config.js`. The sheet must be viewable by "Anyone with the link" and keep the same tabs.

## The small tables that are yours

The sheet describes some things only in words, and lags behind new patches, so these live
in `data/`:

| File | What it holds |
| --- | --- |
| `settings.csv` | Base crit values, crit cap, base armor and health, expertise rules |
| `specializations.csv` | What each specialization adds |
| `talent_effects.csv` | Which numbers of each talent count in the maths (see below) |
| `targets.csv` | Presets for the time-to-kill panel |
| `extra_weapons.csv`, `extra_gear.csv` | Items the sheet does not list yet |
| `augments.csv` | Prototype augments and their values per level |

### Adding an item the sheet is missing

Add a row to `extra_weapons.csv` or `extra_gear.csv`. As soon as the sheet lists an item with
the same name, the sheet's version is used and your row is ignored, so nothing needs cleaning
up later.

- Weapons: leave a number empty to copy it from the weapon named in `copy` (the editor says
  which numbers were copied). `includes` lists which of the weapon's own mod bonuses are
  already inside the numbers you typed (`rof`, `reload`, `mag`), so they are not added twice.
  `mods` are written as `Optics: +15% Critical Hit Chance|Magazine: +50 Rounds`.
- Gear: `minors` are written as `Weapon Handling 8%|Headshot Damage 10%|Mod Slot`. Use
  `Armor 170,000` or `Skill Tier 1` there for the extra cores of pieces like Memento.
- Write `\n` inside a talent text for a line break, and add a row to `talent_effects.csv` if
  the talent should count in the numbers.

### Prototype items and augments

High-end, named and gear set items have a Prototype switch (exotics cannot be Prototype).
With it on, each attribute's limit rises to the "Prototype Max" the sheet lists. Where the
sheet has no value, 1.5 times the normal maximum is used and labelled "estimated", following
Ubisoft's description of the system. A Prototype item also takes one augment at level 1 to 10.

`augments.csv` holds each augment's value at level 1 and the gain per level. Ubisoft has
published numbers for Quantum, Amalgam, Anomaly and Synesthesia only. For the others the
editor shows a box to type the value from the game; fill in `level1` and `per_level` when
you know them and the box goes away. Echo is counted in DPS and Entropy in health; the rest
are listed in the Augments panel.

### How talents are counted

A talent's description comes from the sheet. `talent_effects.csv` says which numbers in that
description matter, by position:

| Template | Meaning |
| --- | --- |
| `chd:{1}` | Critical hit damage equal to the 1st number in the description |
| `twd:{1}x{3}` | 1st number per stack, up to the 3rd number of stacks (shows a stack box) |
| `amp:{3}^{2}` | Same, but each stack multiplies the one before |
| `amp:{1}*20/{2}` | Arithmetic, left to right (`*`, `/`, `//` rounds down) |
| `amp@smg\|shotgun:{2}` | Only for those weapon classes |
| `{mag}`, `{tier}` | The weapon's magazine size, the build's skill tier |
| `{b.2\|1}` | Gear sets: backpack text number 2 if that backpack is worn, else 4-piece text number 1 (`c.` for chest) |

"70% (90%)" in a description is one number: 70 for the normal talent, 90 for the Perfect one.

Because templates point at positions, a patch that only changes numbers is picked up from the
sheet automatically. If the sheet rewords a talent, the site keeps using the last verified
numbers and marks the talent, so a rewording can never silently produce wrong maths. A talent
with no row here is shown with its description and "Not counted in the numbers".

Stat keys are listed at the top of `js/stats.js`. Useful ones: `weapon_damage`, `twd` (total
weapon damage), `amp` (amplified), `chc`, `chd`, `hsd`, `rof`, `mag_size`, `reload_speed`,
`weapon_handling`, `skill_damage`, `total_skill_damage`, `skill_tier`.

## Pictures

Every item has a picture, and all of it is original line art drawn in `js/art.js`: a
silhouette for each weapon class, an illustration for each gear slot and skill, and an emblem
generated from each brand's and gear set's name (so a new brand in the sheet gets one
automatically). No game art is used.

To use your own picture for an item, put the file in `img/items/` named after the item
(`Eagle Bearer.png`, `Striker's Battlegear.png`, or `Striker's Battlegear-chest.png` for one
slot only), run `tools\update-images.ps1`, and upload the `img` folder. Only use pictures you
are allowed to publish.

## Animations

The start-up screen, the reveal of the panels, the counting numbers and the hover effects
follow the visitor's system setting: a system with animation effects turned off gets a still
page. The **Animations** button in the top bar overrides that either way and remembers the
choice in that browser.

## Seasonal calendar

`calendar.html` is a second tool, reached from the switcher in the top bar. It shows what is
live, what is next and what has ended, with countdowns to the 08:00 UTC reset.

It is filled from two tables you keep up to date:

- `data/seasons.csv`: one row per season (`id`, `year`, `name`, `start`, `end`). The page
  opens on the latest season that has started.
- `data/events.csv`: one row per event (`season`, `category`, `name`, `detail`, `start`,
  `end`, `note`). Dates are written `2026-10-13`. Leave a date empty when it is not known,
  and write `permanent` as the end for things that unlock and stay.

### It updates itself

`.github/workflows/update-calendar.yml` makes GitHub run `tools/update_calendar.py` every
hour. The script reads Ubisoft's announcements for the game from Steam's public news feed and
writes `data/news.json` (shown as "Latest from Ubisoft") and `data/auto_events.csv` (events
it could date, shown with an "Added automatically" tag). When something changed, it saves
the files to the repository and the site updates a minute or two later.

It only creates an event when an announcement states real dates, so short events Ubisoft
mentions without clear dates still need a row in `events.csv`. A row you write there wins
over an automatic one with the same name. You can also start the job by hand: Actions tab >
Update calendar > Run workflow.

To add another tool later, create its page and add a link to the `<nav class="tools">` block
in each page's header.

## Player tools

- **Loadout check**: flags what the game would not allow (more than one exotic weapon or
  exotic gear piece, more watch points than your SHD level gives) and what is unfinished
  (empty slots, attributes, mods or talents; crit chance over the cap).
- **What to improve next**: the sustained DPS one more roll of each kind would add to the
  weapon in hand, ranked.
- **Compare builds**: this build next to a saved one, with the difference per stat.
- **Copy as text**: the build as a few lines of text plus its link, for pasting into a chat.
- **SHD level**: enter it in the watch panel to see points spent against points available.

## Matching the game's Stats page

The stats column has two views:

- **Stat sheet** (the default) matches the Stats page in the game's inventory: gear, mods,
  watch, expertise and always-on bonuses. Talents that need a kill, stacks or a status effect
  are left out, exactly as the game leaves them out.
- **In combat** also counts those talents, the way the Talents and bonuses panel is set.

A talent is "always on" when its row in `talent_effects.csv` has `always` in the `default`
column (`off` there means not counted until ticked).

Things the game adds that are not gear:

- **Specialization**: +15% weapon damage for three weapon classes you pick (the planner
  follows your equipped weapons until you pick).
- **Season modifiers and other bonuses**: a list on the page where any stat can be added by
  hand. Seasonal modifiers change every season and depend on what the player selected, so
  the planner cannot know them. If the game shows more than the planner, add the difference.
- Skill mods are not modelled; add their bonuses the same way if you need them.

Values checked against a real character (Y8S3.1): base health 280,350; total base armor
660,014, with expertise raising each piece's own base armor by 1% per grade; exotic weapons
are listed in the sheet with their own mods' rate of fire and reload speed already applied;
a Prototype named item also rolls its named attribute up to 1.5 times higher. The split of
base armor between the six slots in `settings.csv` is an estimate except for the gloves, so
builds with uneven expertise grades can be off by a fraction of a percent.

## How the numbers are worked out

- Bullet damage = base damage x (1 + weapon damage + class damage) x (1 + total weapon damage)
  x each amplifier.
- Crit damage and headshot damage add together on a critical headshot.
- Average bullet uses the build's crit chance (capped) and the headshot chance you enter.
- Sustained DPS = one magazine of damage divided by the time to empty it plus the reload.
- Time to kill shoots through armor first (damage to armor), then health (damage to health).
- Conditional talents are counted the way their "Assumes" line says. Each has a "Count it"
  box, and stacking ones have a stack box.
- Named and exotic weapons are listed in the sheet with their always-on bonuses already in
  their rate of fire, magazine and reload, so those are not added a second time.

Weapon mods: `data/weapon_fits.csv` says which magazine and muzzle kind each weapon family
takes, and the editor lists those mods first under "Fits this weapon". The table is a best
estimate from the weapons' calibres, so every other mod stays selectable under "Other mods".
Correct a row there if the game disagrees. Accuracy and stability are shown as bonuses only,
because the sheet does not list each weapon's base values.

## Run it on your PC

Opening `index.html` by double-clicking does not work, because browsers block data loading
from plain files. Start a small web server in this folder instead:

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Publish on GitHub Pages

Upload everything in this folder to the repository (drag the files and folders onto
**Add file > Upload files**; dragging keeps the folders). With Pages set to deploy from the
`main` branch, the live site updates a minute or two after each upload.

## Files

- `index.html`, `css/style.css`: page and styling
- `js/config.js`: which sheet to read
- `js/sheet.js`: reads the sheet's tabs into game data
- `js/stats.js`: the stats and how bonus text is read
- `js/effects.js`: the talent template language
- `js/data.js`: loading (bundled copy first, then live)
- `js/calc.js`: all the maths
- `js/art.js`: the item pictures
- `js/app.js`: the interface, share links and saved builds

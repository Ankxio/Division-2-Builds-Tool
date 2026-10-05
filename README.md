# Division 2 Build Planner

A build planner for The Division 2. Pick a specialization, weapons, gear, skills and SHD watch
levels, and see set bonuses, damage, DPS, a damage-over-time chart and time to kill. Every build
has its own link you can share.

It is plain HTML, CSS and JavaScript. There is nothing to install or build.

## Run it on your PC

Opening `index.html` by double-clicking does not work, because browsers block data loading from
plain files. Start a small web server in this folder instead:

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Keeping the game data up to date

All game data lives in the tables in `data/`. Nothing about weapons, gear or talents is written
into the code, so a patch never needs a code change.

| Table | What it holds |
| --- | --- |
| `settings` | Game version label, base crit values, what each core gives |
| `stats` | Every stat the site knows: key, display name, unit, group |
| `attributes` | Attributes that can roll on gear, gear mods and weapons, with max values |
| `weapon_types` | Weapon classes and their built-in bonus |
| `weapons` | Weapons: damage, RPM, magazine, reload, fixed talent |
| `weapon_talents`, `weapon_mods` | Talents and attachments |
| `brands` | Brand sets and gear sets with their bonuses per piece count |
| `gear` | Named and exotic gear pieces |
| `gear_talents` | Chest and backpack talents, including gear set ones |
| `specializations`, `skills`, `watch`, `targets` | The rest |

Bonuses are written as `stat:value`, joined with `;` for more than one, using the keys from the
`stats` table. Example: `chc:10;chd:15`. Use `amp:25` for a 25% amplified (multiplying) bonus.

### Use a Google Sheet as the data source

1. Create a Google Sheet. For each file in `data/`, add a tab with the same name (without `.csv`)
   and import that file into it (File > Import > Upload > "Replace current sheet").
2. Click Share and set general access to "Anyone with the link" as Viewer.
3. Copy the sheet ID from its address (`docs.google.com/spreadsheets/d/<ID>/edit`) and paste it
   into `js/config.js`.

From then on the site reads the sheet every time it loads. Edit a row and the change is live on
the next page load. If a tab is missing or cannot be read, the site falls back to the matching
file in `data/`, and the header shows which source was used.

Tip: keep a column all numbers or all text. Google can drop values from columns that mix both.

## Publish on GitHub Pages

1. Create a GitHub repository and upload everything in this folder (keep the `.nojekyll` file).
2. In the repository go to Settings > Pages, choose "Deploy from a branch", pick `main` and `/ (root)`.
3. The site appears at `https://<your-username>.github.io/<repository-name>/` after a minute or two.

## How the numbers are worked out

- Bullet damage = base damage x (1 + all weapon damage + weapon type damage) x each amplifier.
- Crit damage and headshot damage add together on a critical headshot.
- Average bullet uses the build's crit chance (capped by `chc_cap`) and the headshot chance you enter.
- DPS with reloads = one magazine of damage divided by the time to empty it plus the reload.
- Time to kill shoots through armor first (using damage to armor), then health (using damage to health).
- Talents and 4-piece bonuses that depend on stacks are counted at the level their text says, and
  each has a "Count it" box to switch it off.

## Files

- `index.html`, `css/style.css`: page and styling
- `js/config.js`: the Google Sheet ID
- `js/data.js`: loads the tables from the sheet or from `data/`
- `js/calc.js`: all the maths
- `js/app.js`: the interface, share links and saved builds

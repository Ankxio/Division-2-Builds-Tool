// The stats the planner understands, and how to read "12% Critical Hit Chance" style text.

// key: [label, unit, group]
export const STATS = {
  weapon_damage: ['Weapon Damage', '%', 'offense'],
  twd: ['Total Weapon Damage', '%', 'offense'],
  ar_damage: ['Assault Rifle Damage', '%', 'offense'],
  lmg_damage: ['LMG Damage', '%', 'offense'],
  smg_damage: ['SMG Damage', '%', 'offense'],
  shotgun_damage: ['Shotgun Damage', '%', 'offense'],
  rifle_damage: ['Rifle Damage', '%', 'offense'],
  mmr_damage: ['Marksman Rifle Damage', '%', 'offense'],
  pistol_damage: ['Pistol Damage', '%', 'offense'],
  chc: ['Critical Hit Chance', '%', 'offense'],
  chd: ['Critical Hit Damage', '%', 'offense'],
  hsd: ['Headshot Damage', '%', 'offense'],
  dta: ['Damage to Armor', '%', 'offense'],
  dth: ['Damage to Health', '%', 'offense'],
  ooc: ['Damage to Target Out of Cover', '%', 'offense'],
  rof: ['Rate of Fire', '%', 'offense'],
  signature_damage: ['Signature Weapon Damage', '%', 'offense'],
  melee_damage: ['Melee Damage', '%', 'offense'],
  weapon_handling: ['Weapon Handling', '%', 'handling'],
  accuracy: ['Accuracy', '%', 'handling'],
  stability: ['Stability', '%', 'handling'],
  reload_speed: ['Reload Speed', '%', 'handling'],
  swap_speed: ['Swap Speed', '%', 'handling'],
  optimal_range: ['Optimal Range', '%', 'handling'],
  mag_size: ['Magazine Size', '%', 'handling'],
  mag_flat: ['Extra Rounds', '', 'handling'],
  ammo_capacity: ['Ammo Capacity', '%', 'handling'],
  armor: ['Armor', '', 'defense'],
  armor_pct: ['Total Armor', '%', 'defense'],
  health: ['Health', '', 'defense'],
  health_pct: ['Health', '%', 'defense'],
  armor_regen: ['Armor Regeneration', '/s', 'defense'],
  armor_regen_pct: ['Armor Regeneration', '%', 'defense'],
  armor_on_kill: ['Armor on Kill', '', 'defense'],
  armor_on_kill_pct: ['Armor on Kill', '%', 'defense'],
  health_on_kill: ['Health on Kill', '%', 'defense'],
  explosive_resistance: ['Explosive Resistance', '%', 'defense'],
  hazard_protection: ['Hazard Protection', '%', 'defense'],
  protection_elites: ['Protection from Elites', '%', 'defense'],
  incoming_repairs: ['Incoming Repairs', '%', 'defense'],
  pulse_resistance: ['Pulse Resistance', '%', 'defense'],
  disrupt_resistance: ['Disrupt Resistance', '%', 'defense'],
  status_resistance: ['Status Effect Resistance', '%', 'defense'],
  shield_health: ['Shield Health', '%', 'defense'],
  skill_tier: ['Skill Tier', '', 'skill'],
  skill_damage: ['Skill Damage', '%', 'skill'],
  total_skill_damage: ['Total Skill Damage', '%', 'skill'],
  skill_haste: ['Skill Haste', '%', 'skill'],
  skill_duration: ['Skill Duration', '%', 'skill'],
  repair_skills: ['Repair Skills', '%', 'skill'],
  total_skill_repair: ['Total Skill Repair', '%', 'skill'],
  status_effects: ['Status Effects', '%', 'skill'],
  skill_health: ['Skill Health', '%', 'skill'],
  skill_efficiency: ['Skill Efficiency', '%', 'skill'],
  explosive_damage: ['Explosive Damage', '%', 'skill'],
  burn_damage: ['Burn Damage', '%', 'skill'],
  burn_duration: ['Burn Duration', '%', 'skill'],
};

// Names the sheet uses -> [key when the value is a percentage, key when it is a flat number].
const ALIASES = {};
const alias = (names, pct, flat = pct) => names.split('|').forEach(n => { ALIASES[n] = [pct, flat]; });
alias('weapon damage|all weapon damage|wapon damage', 'weapon_damage');
alias('total weapon damage|twd', 'twd');
alias('assault rifle damage|ar damage', 'ar_damage');
alias('lmg damage|light machine gun damage', 'lmg_damage');
alias('smg damage|submachine gun damage', 'smg_damage');
alias('shotgun damage', 'shotgun_damage');
alias('rifle damage', 'rifle_damage');
alias('marksman rifle damage|mmr damage', 'mmr_damage');
alias('pistol damage', 'pistol_damage');
alias('critical hit chance|critical chance|crit chance|chc', 'chc');
alias('critical hit damage|critical damage|crit damage|chd', 'chd');
alias('headshot damage|head shot damage|hsd', 'hsd');
alias('damage to armor|dta|armor damage', 'dta');
alias('damage to health|health damage|dth', 'dth');
alias('damage to target out of cover|dmg to target out of cover|damage to targets out of cover|damage to out of cover', 'ooc');
alias('rate of fire|rof', 'rof');
alias('signature weapon damage', 'signature_damage');
alias('melee damage', 'melee_damage');
alias('weapon handling|handling', 'weapon_handling');
alias('accuracy|weapon accuracy', 'accuracy');
alias('stability|weapon stability', 'stability');
alias('reload speed', 'reload_speed');
alias('swap speed', 'swap_speed');
alias('optimal range', 'optimal_range');
alias('magazine size|mag size', 'mag_size');
alias('rounds', 'mag_flat');
alias('ammo capacity|ammo', 'ammo_capacity');
alias('armor', 'armor_pct', 'armor');
alias('total armor', 'armor_pct');
alias('health', 'health_pct', 'health');
alias('armor regen|armor regeneration', 'armor_regen_pct', 'armor_regen');
alias('armor on kill', 'armor_on_kill_pct', 'armor_on_kill');
alias('health on kill', 'health_on_kill');
alias('explosive resistance|explosive resist', 'explosive_resistance');
alias('hazard protection', 'hazard_protection');
alias('protection from elites', 'protection_elites');
alias('incoming repairs|incoming repair', 'incoming_repairs');
alias('pulse resistance', 'pulse_resistance');
alias('disrupt resistance', 'disrupt_resistance');
alias('status effect resistance', 'status_resistance');
alias('shield health', 'shield_health');
alias('skill tier', 'skill_tier');
alias('skill damage', 'skill_damage');
alias('total skill damage', 'total_skill_damage');
alias('skill haste', 'skill_haste');
alias('skill duration', 'skill_duration');
alias('repair skills|repair skill|skill repair|repair skiills', 'repair_skills');
alias('total skill repair', 'total_skill_repair');
alias('status effects|status effect', 'status_effects');
alias('skill health', 'skill_health');
alias('skill efficiency', 'skill_efficiency');
alias('explosive damage', 'explosive_damage');
alias('burn damage', 'burn_damage');
alias('burn duration', 'burn_duration');

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/armour/g, 'armor').replace(/[^a-z0-9]+/g, ' ').trim();
// For matching item names between tabs: "The Stinger (M249 B)" and "The Stinger" are the same thing.
export const normName = s => norm(String(s || '').replace(/\([^)]*\)/g, ' ')).replace(/^the /, '').replace(/ /g, '');

export function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const title = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

// Stat name from the sheet -> stat key. Names the planner does not know become new
// stats in the "other" group, so they still show up in the totals.
export function statKey(name, isPercent = true) {
  const n = norm(name).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  let hit = ALIASES[n];
  if (!hit && n.length >= 8) {
    const close = Object.keys(ALIASES).find(a => a.length >= 8 && distance(a, n) <= 2);
    if (close) hit = ALIASES[close];
  }
  if (hit) return isPercent ? hit[0] : hit[1];
  const key = `x_${n.replace(/ /g, '_')}`;
  if (!STATS[key]) STATS[key] = [title(n), isPercent ? '%' : '', 'other'];
  return key;
}

export function toNumber(text) {
  let s = String(text ?? '').replace(/,/g, '').trim();
  if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', ''); // "170.000" is 170 thousand
  const v = parseFloat(s);
  return isNaN(v) ? NaN : v;
}

// Reads bonus text into [[statKey, value], ...]. Handles "12% Shotgun Damage",
// "30% MMR Damage 30% Rifle Damage", "Headshot Damage 20%", "+20 Rounds" and ranges
// like "Critical Hit Chance 1.2% - 6%" (the top of the range is used).
export function parseBonus(text) {
  let s = String(text || '').replace(/[><]/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[\d.,?]+\s*%?\s*-\s*(?=\d)/g, '');
  const matches = [...s.matchAll(/(?<![\d.])([+-]?)\s*(\d[\d,]*(?:\.\d+)?)(\+?)\s*(%?)(\/s)?/g)];
  if (!matches.length) return [];
  const numberFirst = s.slice(0, matches[0].index).replace(/[^a-z]/gi, '') === '';
  const out = [];
  matches.forEach((m, i) => {
    const end = m.index + m[0].length;
    const raw = numberFirst
      ? s.slice(end, i + 1 < matches.length ? matches[i + 1].index : s.length)
      : s.slice(i ? matches[i - 1].index + matches[i - 1][0].length : 0, m.index);
    const label = raw.replace(/^[\s,;:&./-]+|[\s,;:&./-]+$/g, '').replace(/^and\s+|\s+and$/i, '');
    const key = statKey(label.replace(/\b(debuff|penalty|bonus|increased|extra|when used)\b/gi, ' '), m[4] === '%');
    if (!key) return;
    let value = toNumber(m[2]) * (m[1] === '-' ? -1 : 1);
    if (/debuff|penalty/i.test(label)) value = -Math.abs(value);
    out.push([key, value]);
  });
  return out;
}

export const statLabel = key => STATS[key]?.[0] || key;
export const statUnit = key => STATS[key]?.[1] || '';
export const statGroup = key => STATS[key]?.[2] || 'other';

// Turns talent descriptions into numbers the calculator can use.
//
// The sheet describes talents in words. data/talent_effects.csv says, for each talent,
// which numbers in that description matter, as a small template. Terms are joined with ";".
//
//   chd:{1}               critical hit damage = the 1st number in the description
//   twd:{1}x{3}           1st number per stack, up to {3} stacks (a stack box is shown)
//   amp:{3}^{2}           same, but every stack multiplies the one before (1.04 x 1.04 x ...)
//   amp:{1}*20/{2}        arithmetic, left to right: * multiply, / divide, // divide and round down
//   stability:-25         a plain number
//   amp@smg|shotgun:{2}   only for those weapon classes
//   {mag} {tier}          the weapon's magazine size, the build's skill tier
//   {b.2|1}               gear sets: number 2 of the backpack talent text if that backpack is
//                         worn, otherwise number 1 of the 4-piece text ({c.…} for the chest)
//   {c?2:1}               2 if the set chest is worn, otherwise 1
//
// Because templates point at positions, a patch that only changes numbers is picked up
// automatically from the sheet. If the wording itself changes, the positions can no longer
// be trusted, so the last known-good text (the bundled snapshot) is used instead.

const NUMBER = /(?<![\d.])([+-]?\d[\d,]*(?:\.\d+)?)(\s*(?:%|s|m)?\s*\(\s*\+?(\d[\d,]*(?:\.\d+)?)\s*(?:%|s|m)?\s*\))?/g;

// Numbers in a description. "70% (90%)" is one number: 70 normally, 90 for the Perfect version.
export function numbersOf(text, perfect = false) {
  const nums = [];
  const shape = String(text || '').replace(NUMBER, (_, n, pair, p) => {
    nums.push(parseFloat((perfect && p ? p : n).replace(/,/g, '')));
    return '#';
  }).toLowerCase().replace(/[^a-z#]+/g, ' ').trim();
  return { nums, shape };
}

// The description as it reads for one version: "+70% (90%)" -> "+70%" or "+90%".
export function resolveText(text, perfect = false) {
  return String(text || '').replace(NUMBER, (all, n, pair, p) => {
    if (!pair) return all;
    const unit = (pair.match(/%|s|m/) || [''])[0];
    return perfect ? `${n.startsWith('+') ? '+' : ''}${p}${unit}` : `${n}${unit}`;
  });
}

function factor(token, ctx) {
  token = token.trim();
  let m;
  if ((m = token.match(/^\{([cb])\?([\d.-]+):([\d.-]+)\}$/))) return (m[1] === 'c' ? ctx.chest : ctx.backpack) ? +m[2] : +m[3];
  if ((m = token.match(/^\{(mag|tier)\}$/))) return ctx.vars?.[m[1]] ?? 0;
  if ((m = token.match(/^\{(?:([cb])\.(\d+)\|)?(?:([cb])\.)?(\d+)\}$/))) {
    const pick = (src, n) => ({ c: ctx.chest, b: ctx.backpack, '': ctx.nums }[src || ''] || [])[n - 1];
    if (!m[1]) return pick(m[3], +m[4]);
    return (m[1] === 'c' ? ctx.chest : ctx.backpack) ? pick(m[1], +m[2]) : pick(m[3], +m[4]);
  }
  const v = Number(token);
  return isNaN(v) ? undefined : v;
}

function arithmetic(expr, ctx) {
  const parts = expr.split(/(\*|\/\/|\/)/);
  let acc = factor(parts[0], ctx);
  for (let i = 1; i < parts.length && acc !== undefined; i += 2) {
    const v = factor(parts[i + 1], ctx);
    if (v === undefined) return undefined;
    acc = parts[i] === '*' ? acc * v : parts[i] === '//' ? Math.floor(acc / v) : acc / v;
  }
  return acc;
}

// Evaluates a template. ctx = { nums, chest, backpack, vars }.
// Returns [{stat, types, per, stacks, compound}] or null when a number it needs is missing.
export function evaluate(template, ctx = {}) {
  const terms = [];
  for (const part of String(template || '').split(';')) {
    const m = part.trim().match(/^([a-z_]+)(?:@([a-z|]+))?:(.+?)(?:(x|\^)(.+))?$/);
    if (!m) continue;
    const per = arithmetic(m[3], ctx);
    const stacks = m[5] ? arithmetic(m[5], ctx) : null;
    if (per === undefined || stacks === undefined || isNaN(per)) return null;
    terms.push({
      stat: m[1], types: m[2] ? m[2].split('|') : null, per,
      stacks: stacks === null ? null : Math.max(0, Math.round(stacks)), compound: m[4] === '^',
    });
  }
  return terms;
}

// What a term adds when `count` stacks are up (ignored for terms without stacks).
export function termValue(term, count) {
  if (term.stacks === null) return term.per;
  const n = Math.max(0, Math.min(term.stacks, count ?? term.stacks));
  return term.compound ? ((1 + term.per / 100) ** n - 1) * 100 : term.per * n;
}

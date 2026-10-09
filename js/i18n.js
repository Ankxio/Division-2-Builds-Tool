// English / French. The pages are written in English; in French this translates whatever is
// put on screen, as it is put there, using the texts in js/fr.js. Switching language reloads
// the page (a build survives that: it lives in the address).
//
// Each page's <head> picks the language before anything is drawn (the visitor's choice, else
// the browser's language) and leaves it in <html data-lang>.

import { WORDS, TERMS, RULES, SCOPED } from './fr.js';

const root = document.documentElement;
const STORE = 'd2.lang';

function fallback() {
  try { const saved = localStorage.getItem(STORE); if (saved === 'fr' || saved === 'en') return saved; } catch { /* storage blocked */ }
  return /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
}

export const lang = root.dataset.lang === 'fr' || root.dataset.lang === 'en' ? root.dataset.lang : fallback();
export const locale = lang === 'fr' ? 'fr-FR' : 'en-US';       // numbers
export const dateLocale = lang === 'fr' ? 'fr-FR' : 'en-GB';   // dates

export function setLang(next) {
  if (next === lang) return;
  try { localStorage.setItem(STORE, next); } catch { /* storage blocked: nothing to remember it with */ }
  location.reload();
}

// ---- text -> French ----

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBER = '[+\\-−]?\\d[\\d.,\\u202f\\u00a0]*\\s?%?(?:/s)?';
// "15% Weapon Damage", "+1 Skill Tier": a number followed by a stat the game has.
const PHRASE = new RegExp(`(${NUMBER})\\s+(${Object.keys(TERMS).sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![a-z])`, 'gi');
const BETWEEN = /^[\s,;·/|&+]*$/;
const cased = (english, french) => (/^[A-Z]/.test(english) ? french.charAt(0).toUpperCase() + french.slice(1) : french);
// French puts a no-break space before : ; ? ! and inside « ».
const spaced = text => text.replace(/ ([:;?!»])/g, ' $1').replace(/« /g, '« ');

function phrases(text) {
  if (!BETWEEN.test(text.replace(PHRASE, ''))) return undefined; // something else is in there: not a list of bonuses
  let found = false;
  const out = text.replace(PHRASE, (all, number, label) => { found = true; return `${number} ${cased(label, TERMS[label.toLowerCase()])}`; });
  return found ? out : undefined;
}

const cache = new Map();
function one(text) {
  if (cache.has(text)) return cache.get(text);
  let out = WORDS[text];
  if (out === undefined && TERMS[text.toLowerCase()]) out = cased(text, TERMS[text.toLowerCase()]);
  if (out === undefined) {
    for (const [pattern, make] of RULES) {
      const match = text.match(pattern);
      if (match) { out = make(match, one); break; }
    }
  }
  if (out === undefined) out = phrases(text);
  if (out === undefined && text.includes(' · ')) {
    const parts = text.split(' · '), done = parts.map(one);
    if (done.some((part, i) => part !== parts[i])) out = done.join(' · ');
  }
  if (out === undefined) out = text;
  if (cache.size > 6000) cache.clear();
  cache.set(text, out);
  return out;
}

// Texts that stayed in English, for checking coverage: add ?i18n=debug to the address and
// read window.d2Untranslated in the console.
const debug = /[?&]i18n=debug/.test(location.search);
const untranslated = new Set();
if (debug) window.d2Untranslated = untranslated;

export function tr(text) {
  if (lang !== 'fr' || typeof text !== 'string' || !/[A-Za-z]/.test(text)) return text;
  const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const key = core.replace(/\s+/g, ' ');
  const out = one(key);
  if (out === key) { if (debug && /[A-Za-z]{3}/.test(key)) untranslated.add(key); return text; }
  return lead + spaced(out) + trail;
}

// ---- the page ----

const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'label', 'alt'];
const SCOPED_WORDS = new Set(SCOPED.flatMap(([, words]) => Object.keys(words)));

function textNode(node) {
  const value = node.nodeValue, parent = node.parentElement;
  if (!parent || !/[A-Za-z]/.test(value)) return;
  let out;
  const word = value.trim();
  if (SCOPED_WORDS.has(word)) {
    const scope = SCOPED.find(([selector, words]) => words[word] && parent.matches(selector));
    if (scope) out = value.replace(word, scope[1][word]);
  }
  out ??= tr(value);
  if (out !== value && !parent.closest('script, style, [translate="no"]')) node.nodeValue = out;
}

function element(el) {
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const out = tr(value);
    if (out !== value) el.setAttribute(name, out);
  }
}

function walk(node) {
  if (node.nodeType === Node.TEXT_NODE) return textNode(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  element(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) (n.nodeType === Node.TEXT_NODE ? textNode : element)(n);
}

if (lang === 'fr') {
  root.lang = 'fr';
  document.title = tr(document.title);
  for (const meta of document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]')) meta.content = tr(meta.content);
  walk(document.body);
  // Everything drawn later goes through the same translation, before it is painted.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(walk);
      else if (record.type === 'characterData') textNode(record.target);
      else element(record.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
}
// The <head> script keeps a French page hidden until here, so English is never flashed first.
root.dataset.ready = '1';

// The EN / FR buttons in the top bar.
for (const button of document.querySelectorAll('[data-lang-pick]')) button.setAttribute('aria-pressed', String(button.dataset.langPick === lang));
document.addEventListener('click', e => {
  const button = e.target.closest('[data-lang-pick]');
  if (button) setLang(button.dataset.langPick);
});

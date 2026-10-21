// ROADMAP.md (at the repository root) → the data the roadmap page renders at build time.
import source from '../../../ROADMAP.md?raw';
import { inline } from './markdown.js';
import { REPO_URL } from './url';

export interface Item { html: string; text: string; gfi: boolean; done: boolean; discuss: string }
export interface Area { id: string; title: string; note: string; items: Item[] }
export interface Milestone { kind: 'next' | 'later'; title: string; range: string | null; count: number; areas: Area[] }
interface RawSection { title: string; areas: { title: string; items: RawItem[]; text: string[] }[]; items: RawItem[]; text: string[] }
interface RawItem { done: boolean; text: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const kindOf = (title: string) => (/^shipped/i.test(title) ? 'shipped' : /^next/i.test(title) ? 'next'
  : /^later/i.test(title) ? 'later' : /limitation/i.test(title) ? 'limits' : 'other');

function parse(md: string) {
  const principles: string[] = [];
  const sections: RawSection[] = [];
  let sec: RawSection | null = null;
  let area: RawSection['areas'][number] | null = null;
  let item: RawItem | null = null;
  let inPrinciples = false;
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (/^# /.test(line)) continue;
    if (/^\*\*Guiding principles\*\*/.test(line)) { inPrinciples = true; continue; }
    if ((m = line.match(/^## (.+)/))) {
      sec = { title: m[1], areas: [], items: [], text: [] };
      sections.push(sec);
      area = item = null;
      inPrinciples = false;
      continue;
    }
    if ((m = line.match(/^### (.+)/)) && sec) { area = { title: m[1], items: [], text: [] }; sec.areas.push(area); item = null; continue; }
    if (line === '---' || !line.trim()) { item = null; continue; }
    if ((m = line.match(/^- (?:\[([ xX])\] )?(.+)/))) {
      if (inPrinciples) { principles.push(m[2]); continue; }
      if (!sec) continue;
      item = { done: (m[1] || '').toLowerCase() === 'x', text: m[2] };
      (area ?? sec).items.push(item);
      continue;
    }
    if (item && /^\s+\S/.test(raw)) { item.text += ` ${line.trim()}`; continue; }
    if (sec) (area ?? sec).text.push(line.trim());
  }
  return { principles, sections };
}

function toItem(raw: RawItem): Item {
  const gfi = /\*\(good first issue\)\*/i.test(raw.text);
  const text = raw.text.replace(/\s*\*\(good first issue\)\*/i, '');
  const title = (text.match(/\*\*([^*]+)\*\*/)?.[1] ?? text.split(/[—:.(]/)[0]).trim();
  return {
    html: inline(text), text: text.toLowerCase(), gfi, done: raw.done,
    discuss: `${REPO_URL}/issues?q=${encodeURIComponent(`is:issue ${title}`)}`,
  };
}

const doc = parse(source);
const by = Object.fromEntries(doc.sections.map((s) => [kindOf(s.title), s]));

export const principles = doc.principles.map((p) => {
  const m = p.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  return { title: inline(m ? m[1] : p), text: inline(m ? m[2] : '') };
});

export const shipped = by.shipped ? {
  title: by.shipped.title,
  features: by.shipped.text.join(' ').split(/\s+·\s+/).map((t) => t.trim()).filter(Boolean)
    .map((t) => ({ html: inline(t), text: t.toLowerCase() })),
} : null;

export const milestones: Milestone[] = (['next', 'later'] as const).filter((k) => by[k]).map((kind) => {
  const sec = by[kind];
  const areas = sec.areas.map((a) => ({ id: slug(a.title), title: inline(a.title), note: a.text.length ? inline(a.text.join(' ')) : '', items: a.items.map(toItem) }));
  return {
    kind,
    title: kind === 'next' ? 'Coming next' : 'Further out',
    range: sec.title.match(/\(([^)]+)\)/)?.[1] ?? null,
    count: areas.reduce((n, a) => n + a.items.length, 0),
    areas,
  };
});

export const limits = by.limits ? { title: by.limits.title, items: by.limits.items.map((i) => inline(i.text)) } : null;

const planned = milestones.flatMap((m) => m.areas.flatMap((a) => a.items));
export const stats = {
  planned: planned.filter((i) => !i.done).length,
  gfi: planned.filter((i) => i.gfi).length,
  areas: milestones.reduce((n, m) => n + m.areas.length, 0),
};

// Document the values from the published stylesheet, including aliases such as --bg: var(--gau-900).
import css from '../styles/tokens.css?raw';

function declarations(selector: string) {
  const block = css.split(selector + ' {')[1].split('\n}')[0];
  return Object.fromEntries(Array.from(block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm), ([, name, value]) => [name, value.trim()]));
}
const night = declarations(':root');
const day = { ...night, ...declarations('[data-theme="light"]') };

export function token(name: string, theme = night): string {
  const value = theme[name];
  if (!value) throw new Error(`Missing design token ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  if (alias) return token(alias[1], theme);
  return value.startsWith('#') ? value.toUpperCase() : value;
}

export const nature = [
  ['--iratze', 'Iratzea'], ['--goroldio', 'Goroldioa'], ['--itsaso', 'Itsasoa'], ['--txilar', 'Txilarra'],
  ['--txingar', 'Txingarra'], ['--eguzki', 'Eguzkia'], ['--hezur', 'Hezurra'],
];
export const ramps = [
  ['--gau-950', '--gau-900', '--gau-850', '--gau-800', '--gau-700', '--gau-600'],
  ['--laino-600', '--laino-400', '--laino-200', '--laino-50'], ['--egun-200', '--egun-100', '--egun-50'],
];
export const semantic = ['--bg', '--surface', '--surface-3', '--line', '--text', '--text-2', '--text-3',
  '--accent', '--accent-text', '--success', '--info', '--warning', '--danger']
  .map((name) => ({ name, values: [token(name), token(name, day)] }));

export const curves = ['grow', 'swap', 'spring'].map((key, i) => {
  const name = '--ease-' + key;
  const value = token(name);
  const [x1, y1, x2, y2] = value.slice('cubic-bezier('.length, -1).split(',').map(Number);
  const point = (x: number, y: number) => `${Math.round(x * 100)} ${Math.round(100 - y * 100)}`;
  return { name, value, word: ['hazi', 'aldatu', 'jauzi'][i], a: point(x1, y1), b: point(x2, y2) };
});

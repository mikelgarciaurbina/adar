// The one live number on the site: GitHub stars, read from the public API in the visitor's browser
// (no token, cached for the session). Release data is rendered at build time instead (src/lib/releases.ts).

const API = 'https://api.github.com/repos/mikelgarciaurbina/adar';
const KEY = 'adar:repo';
const TTL = 15 * 60 * 1000;

export async function repo() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (hit && Date.now() - hit.at < TTL) return hit.data;
  } catch { /* storage unavailable */ }
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const r = await res.json();
  const data = { stars: r.stargazers_count };
  try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}

export const formatCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

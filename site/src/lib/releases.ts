// GitHub Releases, read once at build time: the changelog and the download section are plain HTML. The
// release workflow asks Cloudflare Pages to rebuild the site after every release, so they stay current. With
// GITHUB_TOKEN set (a read-only token in the Pages project's variables, never printed) the request is
// authenticated; otherwise it is anonymous, which Cloudflare's shared build machines can run out of.
// Locally, without network the pages fall back to links to the releases page. On Cloudflare Pages
// (CF_PAGES=1) a build without releases fails instead, so the live site keeps its download links.
import { REPO } from './url';

export interface Asset { name: string; size: number; url: string; sha256: string | null }
export interface Release { tag: string; version: string; name: string; url: string; date: string; body: string; prerelease: boolean; assets: Asset[] }

let cached: Promise<Release[]> | undefined;

/** Builds that publish the site: a page without releases must never replace the live one. */
const strict = () => process.env.CF_PAGES === '1' || process.env.ADAR_SITE_STRICT === '1';

/** The releases list from the API, asked again after a moment when GitHub fails or limits the rate. */
async function fetchReleases(headers: Record<string, string>): Promise<any[]> {
  let last: Error | null = null;
  for (const wait of [0, 5_000, 20_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers });
      if (res.ok) return (await res.json()) as any[];
      const limited = res.headers.get('x-ratelimit-remaining') === '0';
      last = new Error(`GitHub API answered ${res.status}${limited ? ' (rate limit reached)' : ''}`);
      // A wrong token or repository does not get better by asking again.
      if (res.status === 401 || res.status === 404) break;
    } catch (e) {
      last = e as Error;
    }
  }
  throw last ?? new Error('GitHub API did not answer');
}

export function getReleases(): Promise<Release[]> {
  cached ??= (async () => {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'adar-site' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
      const list = await fetchReleases(headers);
      return list.filter((r) => !r.draft).map((r): Release => ({
        tag: r.tag_name,
        version: String(r.tag_name).replace(/^v/, ''),
        name: r.name || r.tag_name,
        url: r.html_url,
        date: r.published_at,
        body: r.body || '',
        prerelease: !!r.prerelease,
        assets: (r.assets || []).map((a: any) => ({
          name: a.name, size: a.size, url: a.browser_download_url,
          sha256: typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null,
        })),
      }));
    } catch (e) {
      const why = (e as Error).message;
      if (strict()) throw new Error(`[adar-site] GitHub releases unavailable (${why}): failing the build so the live site keeps its downloads`);
      console.warn(`[adar-site] GitHub releases unavailable, using fallbacks: ${why}`);
      return [];
    }
  })();
  return cached;
}

export async function getLatest() {
  return (await getReleases()).find((r) => !r.prerelease) ?? null;
}

export const formatSize = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;
// The release notes repeat the install steps the download section already shows.
export const withoutInstall = (body: string) => body.replace(/^#{1,4}\s+Install\b[\s\S]*?(?=^#{1,4}\s|(?![\s\S]))/m, '').trim();

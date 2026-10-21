// GitHub Releases, read once at build time: the changelog and the download section are plain HTML. The
// Pages workflow rebuilds the site after every release, so they stay current. In CI the request uses the
// workflow's GITHUB_TOKEN (never printed); locally it is anonymous, and without network the pages fall
// back to links to the releases page.
import { REPO } from './url';

export interface Asset { name: string; size: number; url: string; sha256: string | null }
export interface Release { tag: string; version: string; name: string; url: string; date: string; body: string; prerelease: boolean; assets: Asset[] }

let cached: Promise<Release[]> | undefined;

export function getReleases(): Promise<Release[]> {
  cached ??= (async () => {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'adar-site' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers });
      if (!res.ok) throw new Error(`GitHub API answered ${res.status}`);
      const list = (await res.json()) as any[];
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
      console.warn(`[adar-site] GitHub releases unavailable, using fallbacks: ${(e as Error).message}`);
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

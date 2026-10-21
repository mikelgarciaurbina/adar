// robots.txt: everything may be crawled; points crawlers at the sitemap.
import { SITE_URL } from '../lib/url';

export const GET = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`, {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});

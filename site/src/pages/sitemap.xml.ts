// sitemap.xml for the site's pages (the 404 page and the published files are left out).
import { SITE_URL } from '../lib/url';

const PAGES = ['', 'roadmap.html', 'design.html'];

export const GET = () => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PAGES.map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

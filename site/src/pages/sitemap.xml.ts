// sitemap.xml: every page in every language, each listing its translations (hreflang alternates).
import { LOCALES, DEFAULT_LOCALE, absoluteUrl, type PageKey } from '../i18n/config';

const PAGES: PageKey[] = ['home', 'roadmap', 'design'];

export const GET = () => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PAGES.flatMap((page) => LOCALES.map((lang) => {
    const alternates = [...LOCALES.map((l) => [l, absoluteUrl(page, l)]), ['x-default', absoluteUrl(page, DEFAULT_LOCALE)]]
      .map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`).join('\n');
    return `  <url>\n    <loc>${absoluteUrl(page, lang)}</loc>\n    <lastmod>${lastmod}</lastmod>\n${alternates}\n  </url>`;
  })).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

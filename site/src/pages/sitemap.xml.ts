// sitemap.xml: every page in every language. Translations are declared once, in each page's <head> (hreflang
// alternates in layouts/Base.astro); repeating them here as xhtml:link would also make browsers show the file as text.
import { LOCALES, ROUTES, absoluteUrl, type PageKey } from '../i18n/config';

const PAGES = Object.keys(ROUTES) as PageKey[];

export const GET = () => {
  const urls = PAGES.flatMap((page) => LOCALES.map((lang) =>
    `  <url>\n    <loc>${absoluteUrl(page, lang)}</loc>\n  </url>`)).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

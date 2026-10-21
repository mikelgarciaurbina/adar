// The Adar website: static pages at https://adargit.com, deployed by Cloudflare Pages from this repository
// (root directory `site`). The address is used for canonical and social-card URLs; SITE_URL overrides it.
import { defineConfig } from 'astro/config';

const siteUrl = new URL(process.env.SITE_URL || 'https://adargit.com/');

export default defineConfig({
  site: siteUrl.origin,
  base: siteUrl.pathname.replace(/\/$/, '') || '/',
  // One .html file per page (es/hoja-de-ruta.html); Cloudflare Pages serves them without the extension,
  // which is how the site links to them (/es/hoja-de-ruta). Routes per language: src/i18n/config.ts.
  build: { format: 'file', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: {
    // roadmap.astro reads ../ROADMAP.md, which lives outside this project.
    server: { fs: { allow: ['..'] } },
    // No inline scripts: the pages' Content-Security-Policy only allows scripts from the site itself.
    build: { assetsInlineLimit: 0 },
  },
});

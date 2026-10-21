// The Adar website: static pages, deployed by Cloudflare Pages from this repository (root directory `site`).
// SITE_URL is the public address (path included) used for canonical and social-card URLs; until it is set,
// Cloudflare builds fall back to the deployment's own URL (CF_PAGES_URL) and local builds to localhost.
import { defineConfig } from 'astro/config';

const siteUrl = new URL(process.env.SITE_URL || process.env.CF_PAGES_URL || 'http://localhost:4321/');

export default defineConfig({
  site: siteUrl.origin,
  base: siteUrl.pathname.replace(/\/$/, '') || '/',
  // Keep the .html URLs the site has always had (README and release notes link to roadmap.html).
  build: { format: 'file', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: {
    // roadmap.astro reads ../ROADMAP.md, which lives outside this project.
    server: { fs: { allow: ['..'] } },
    // No inline scripts: the pages' Content-Security-Policy only allows scripts from the site itself.
    build: { assetsInlineLimit: 0 },
  },
});

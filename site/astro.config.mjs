// The Adar website: static pages. SITE_URL is the public address, path included; the default is GitHub
// Pages (.github/workflows/pages.yml). Elsewhere, e.g. Cloudflare Pages, set SITE_URL=https://adar.pages.dev/.
import { defineConfig } from 'astro/config';

const siteUrl = new URL(process.env.SITE_URL || 'https://mikelgarciaurbina.github.io/adar/');

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

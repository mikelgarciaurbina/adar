// Site-relative URLs that respect the deploy base (the path of SITE_URL, usually /; see astro.config.mjs).
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export const url = (path = '') => BASE + path.replace(/^\//, '');

/** The public address of the site, ending in a slash (canonical and social-card URLs). */
export const SITE_URL = new URL(BASE, import.meta.env.SITE).href;

export const REPO = 'mikelgarciaurbina/adar';
export const REPO_URL = `https://github.com/${REPO}`;

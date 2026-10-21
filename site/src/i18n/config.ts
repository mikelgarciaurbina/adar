// Languages, localized routes and localized in-page anchors. English is the default and lives at the root;
// Spanish and Basque live under /es and /eu, with page slugs and anchors in their own language.
import { url, SITE_URL } from '../lib/url';

export const LOCALES = ['en', 'es', 'eu'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_INFO: Record<Locale, { name: string; short: string; og: string; intl: string }> = {
  en: { name: 'English', short: 'EN', og: 'en_US', intl: 'en' },
  es: { name: 'Español', short: 'ES', og: 'es_ES', intl: 'es' },
  eu: { name: 'Euskara', short: 'EU', og: 'eu_ES', intl: 'eu' },
};

export type PageKey = 'home' | 'roadmap' | 'design';
export const ROUTES: Record<PageKey, Record<Locale, string>> = {
  home: { en: '', es: 'es', eu: 'eu' },
  roadmap: { en: 'roadmap', es: 'es/hoja-de-ruta', eu: 'eu/bide-orria' },
  design: { en: 'design', es: 'es/diseno', eu: 'eu/diseinua' },
};

// Section ids that are linked to from other pages (or from the navigation).
export const ANCHORS = {
  name: { en: 'name', es: 'nombre', eu: 'izena' },
  features: { en: 'features', es: 'funciones', eu: 'ezaugarriak' },
  download: { en: 'download', es: 'descarga', eu: 'deskarga' },
  changelog: { en: 'changelog', es: 'novedades', eu: 'berritasunak' },
  contribute: { en: 'contribute', es: 'contribuir', eu: 'lagundu' },
  next: { en: 'next', es: 'proximo', eu: 'hurrengoa' },
  later: { en: 'later', es: 'mas-adelante', eu: 'geroago' },
  shipped: { en: 'shipped', es: 'publicado', eu: 'argitaratua' },
  logo: { en: 'logo', es: 'logo', eu: 'logoa' },
  color: { en: 'color', es: 'color', eu: 'kolorea' },
} satisfies Record<string, Record<Locale, string>>;
export type AnchorKey = keyof typeof ANCHORS;

export const anchor = (key: AnchorKey, lang: Locale) => ANCHORS[key][lang];

/** Site-relative URL of a page (and optional section) in a language. */
export function pageUrl(page: PageKey, lang: Locale, section?: AnchorKey) {
  return url(ROUTES[page][lang]) + (section ? `#${ANCHORS[section][lang]}` : '');
}

/** Absolute URL of a page in a language (canonical, hreflang, sitemap). */
export const absoluteUrl = (page: PageKey, lang: Locale) => SITE_URL + ROUTES[page][lang];

// Basque short dates in CLDR read "2026 urr. 21(a)"; the numeric form is the clearer convention there.
export const formatDateIn = (iso: string, lang: Locale) => (lang === 'eu'
  ? iso.slice(0, 10).replaceAll('-', '/')
  : new Date(iso).toLocaleDateString(LOCALE_INFO[lang].intl, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }));

// Interface strings shared by every page: navigation, footer, buttons and the few strings scripts need.
// Strings may contain trusted inline HTML (rendered with set:html).
import type { Locale } from './config';

export const ui = {
  en: {
    skip: 'Skip to content',
    home: 'Adar home',
    navAria: 'Main',
    menu: 'Menu',
    github: 'Adar on GitHub',
    download: 'Download',
    language: 'Language',
    chapters: 'Chapters',
    nav: { name: 'The name', features: 'Features', download: 'Download', roadmap: 'Roadmap', changelog: 'Changelog', design: 'Design' },
    footer: {
      about: 'A fast, visual Git client for every repository. Free and open source, made in Euskal Herria.',
      product: 'Product', project: 'Project', brand: 'Brand',
      features: 'Features', download: 'Download', changelog: 'Changelog', roadmap: 'Roadmap',
      github: 'GitHub', issues: 'Issues', contributing: 'Contributing', security: 'Security',
      design: 'Design system', logo: 'Logo', colour: 'Colour', license: 'MIT license',
      legal: 'Mikel García · MIT. Inspired by GitKraken’s UX; an independent project, not affiliated with GitKraken or Axosoft.',
      joke: '— no, we’re not pulling your leg: it’s free.',
    },
    client: {
      copy: 'Copy', copied: 'Copied', copiedAnnounce: 'Copied to clipboard',
      pause: 'Pause animations', play: 'Play animations',
    },
  },
  es: {
    skip: 'Saltar al contenido',
    home: 'Inicio de Adar',
    navAria: 'Principal',
    menu: 'Menú',
    github: 'Adar en GitHub',
    download: 'Descargar',
    language: 'Idioma',
    chapters: 'Capítulos',
    nav: { name: 'El nombre', features: 'Funciones', download: 'Descarga', roadmap: 'Hoja de ruta', changelog: 'Novedades', design: 'Diseño' },
    footer: {
      about: 'Un cliente de Git visual y rápido para cualquier repositorio. Gratis y de código abierto, hecho en Euskal Herria.',
      product: 'Producto', project: 'Proyecto', brand: 'Marca',
      features: 'Funciones', download: 'Descarga', changelog: 'Novedades', roadmap: 'Hoja de ruta',
      github: 'GitHub', issues: 'Issues', contributing: 'Contribuir', security: 'Seguridad',
      design: 'Sistema de diseño', logo: 'Logo', colour: 'Color', license: 'Licencia MIT',
      legal: 'Mikel García · MIT. Inspirado en la experiencia de uso de GitKraken; es un proyecto independiente, sin relación con GitKraken ni con Axosoft.',
      joke: ': no, no te tomamos el pelo, es gratis.',
    },
    client: {
      copy: 'Copiar', copied: 'Copiado', copiedAnnounce: 'Copiado al portapapeles',
      pause: 'Pausar animaciones', play: 'Reanudar animaciones',
    },
  },
  eu: {
    skip: 'Joan edukira',
    home: 'Adarren hasiera',
    navAria: 'Nagusia',
    menu: 'Menua',
    github: 'Adar GitHub-en',
    download: 'Deskargatu',
    language: 'Hizkuntza',
    chapters: 'Kapituluak',
    nav: { name: 'Izena', features: 'Ezaugarriak', download: 'Deskarga', roadmap: 'Bide-orria', changelog: 'Berritasunak', design: 'Diseinua' },
    footer: {
      about: 'Edozein biltegitarako Git bezero bisual eta azkarra. Doakoa eta kode irekikoa, Euskal Herrian egina.',
      product: 'Produktua', project: 'Proiektua', brand: 'Marka',
      features: 'Ezaugarriak', download: 'Deskarga', changelog: 'Berritasunak', roadmap: 'Bide-orria',
      github: 'GitHub', issues: 'Issue-ak', contributing: 'Laguntzea', security: 'Segurtasuna',
      design: 'Diseinu-sistema', logo: 'Logoa', colour: 'Kolorea', license: 'MIT lizentzia',
      legal: 'Mikel García · MIT. GitKrakenen erabilera-esperientzian oinarritua; proiektu independentea da, GitKraken eta Axosoft-ekin loturarik gabea.',
      joke: ': doakoa da, benetan.',
    },
    client: {
      copy: 'Kopiatu', copied: 'Kopiatuta', copiedAnnounce: 'Arbelean kopiatuta',
      pause: 'Gelditu animazioak', play: 'Abiarazi animazioak',
    },
  },
} satisfies Record<Locale, unknown>;

export type UI = (typeof ui)['en'];

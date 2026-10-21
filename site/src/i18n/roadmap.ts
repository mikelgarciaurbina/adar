// Roadmap page copy. The roadmap items (ROADMAP.md) and the release notes come from the repository and
// stay in English; the guiding principles are translated here for Spanish and Basque.
import type { Locale } from './config';

const gfi = '<span class="gfi">good first issue</span>';
const ISSUES = 'https://github.com/mikelgarciaurbina/adar/issues';
const AGENTS = '<a class="link" href="https://github.com/mikelgarciaurbina/adar/blob/main/AGENTS.md">AGENTS.md</a>';
const CONTRIBUTING = '<a class="link" href="https://github.com/mikelgarciaurbina/adar/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>';
const gfiButton = (label: string) => `<button class="link-btn" type="button" data-show-gfi>${label}</button>`;

const en = {
  meta: {
    title: 'Adar roadmap — where the branches grow next',
    description: 'Adar’s open-source roadmap: what shipped, what comes next, the good first issues waiting for contributors, and the full changelog.',
    ogTitle: 'Adar roadmap',
    ogDescription: 'Where Adar is heading, what shipped, and how to help.',
  },
  hero: {
    eyebrow: 'Open-source roadmap',
    title: 'Where Adar <span class="serif">grows next.</span>',
    lede: `Priorities change with feedback: open an issue to discuss an item, vote with 👍 on existing issues, or pick something up. Items marked ${gfi} are small and self-contained.`,
    showGfi: 'Show good first issues', suggest: 'Suggest an idea',
    stats: ['Planned', 'Good first issues', 'Areas', 'Releases'],
    fig: '<span>fig. 5</span> git log --graph --all — <i>the branches still to come</i>',
  },
  principlesTitle: 'Guiding principles',
  principles: null as null | { title: string; text: string }[], // English: read from ROADMAP.md
  bar: { show: 'Show', filters: ['All', 'Next', 'Later', 'Shipped'], gfi: 'Good first issues', search: 'Filter the roadmap…' },
  englishNote: '',
  graph: {
    listLabel: 'Roadmap',
    shipped: (version: string) => `Shipped in ${version}`, features: 'features',
    here: 'You are here', hereAria: 'You are here',
    kinds: { next: 'next', later: 'later', shipped: 'shipped' },
    titles: { next: 'Coming next', later: 'Further out' },
    items: 'items', discuss: 'Discuss', done: 'done',
    empty: `Nothing matches that filter — try another word, or <a class="link" href="${ISSUES}/new/choose">suggest it</a>.`,
  },
  changelog: {
    eyebrow: 'Changelog',
    title: 'Every release, <span class="serif">commit by commit.</span>',
    text: 'Straight from GitHub Releases — the same notes the in-app updater shows under “What’s new”.',
    latest: 'Latest', prerelease: 'Pre-release', link: 'Release page &amp; downloads',
    none: `See <a class="link" href="https://github.com/mikelgarciaurbina/adar/releases">all releases on GitHub</a>.`,
  },
  contribute: {
    eyebrow: 'Contribute',
    title: 'Pick a branch. <span class="serif">Make it grow.</span>',
    text: 'Adar is small enough that one pull request changes it. Here is the shortest path from idea to merge.',
    steps: [
      ['Choose', `Take a ${gfiButton('good first issue')} or <a class="link" href="${ISSUES}">an open issue</a>. Say you’re on it so nobody duplicates work.`],
      ['Set up', ''],
      ['Read the map', `${AGENTS} explains the architecture, conventions and safety rules.`],
      ['Open a PR', `Keep it focused, run <code>npm run typecheck</code> and <code>npm test</code>, and follow ${CONTRIBUTING}.`],
    ],
    copyCommand: 'Copy command',
    limits: null as null | string, // English: the section title from ROADMAP.md
  },
  client: { item: 'item', items: 'items' },
};

export type RoadmapContent = typeof en;

const es: RoadmapContent = {
  meta: {
    title: 'Hoja de ruta de Adar — hacia dónde crecen las ramas',
    description: 'La hoja de ruta de código abierto de Adar: qué ha salido, qué viene, las good first issues que esperan a quien quiera contribuir y todas las novedades.',
    ogTitle: 'Hoja de ruta de Adar',
    ogDescription: 'Hacia dónde va Adar, qué ha salido ya y cómo ayudar.',
  },
  hero: {
    eyebrow: 'Hoja de ruta abierta',
    title: 'Hacia dónde <span class="serif">crece Adar.</span>',
    lede: `Las prioridades cambian con lo que nos contáis: abre una issue para comentar un punto, vota con 👍 las que ya existen o ponte con algo. Los puntos marcados ${gfi} son pequeños e independientes.`,
    showGfi: 'Ver good first issues', suggest: 'Propón una idea',
    stats: ['Planeado', 'Good first issues', 'Áreas', 'Versiones'],
    fig: '<span>fig. 5</span> git log --graph --all — <i>las ramas que están por venir</i>',
  },
  principlesTitle: 'Principios',
  principles: [
    { title: 'Funciona con cualquier repositorio.', text: 'Adar usa el git y las credenciales de quien lo usa; sin cuentas ni ataduras.' },
    { title: 'Rápido en repositorios grandes.', text: 'Cada función tiene que ir fluida con más de 100.000 commits y miles de refs.' },
    { title: 'Seguro por defecto.', text: 'Las operaciones destructivas se confirman y, siempre que se puede, se pueden deshacer.' },
    { title: 'Privado por defecto.', text: 'Sin telemetría. Todo lo que habla con un servicio de terceros es opcional.' },
  ],
  bar: { show: 'Mostrar', filters: ['Todo', 'Próximo', 'Más adelante', 'Publicado'], gfi: 'Good first issues', search: 'Filtrar la hoja de ruta…' },
  englishNote: 'Los puntos de la hoja de ruta y las notas de versión se escriben en inglés en el repositorio.',
  graph: {
    listLabel: 'Hoja de ruta',
    shipped: (version: string) => `Publicado en ${version}`, features: 'funciones',
    here: 'Estás aquí', hereAria: 'Estás aquí',
    kinds: { next: 'próximo', later: 'después', shipped: 'publicado' },
    titles: { next: 'Lo próximo', later: 'Más adelante' },
    items: 'puntos', discuss: 'Comentar', done: 'hecho',
    empty: `Nada coincide con ese filtro: prueba con otra palabra o <a class="link" href="${ISSUES}/new/choose">propónlo</a>.`,
  },
  changelog: {
    eyebrow: 'Novedades',
    title: 'Cada versión, <span class="serif">commit a commit.</span>',
    text: 'Directamente de GitHub Releases: las mismas notas que muestra el actualizador de la app en «What’s new».',
    latest: 'Última', prerelease: 'Versión previa', link: 'Página de la versión y descargas',
    none: `Mira <a class="link" href="https://github.com/mikelgarciaurbina/adar/releases">todas las versiones en GitHub</a>.`,
  },
  contribute: {
    eyebrow: 'Contribuye',
    title: 'Elige una rama. <span class="serif">Hazla crecer.</span>',
    text: 'Adar es lo bastante pequeño como para que un solo pull request lo cambie. Este es el camino más corto de la idea al merge.',
    steps: [
      ['Elige', `Coge una ${gfiButton('good first issue')} o <a class="link" href="${ISSUES}">una issue abierta</a>. Avisa de que estás con ella para que nadie duplique trabajo.`],
      ['Prepárate', ''],
      ['Lee el mapa', `${AGENTS} explica la arquitectura, las convenciones y las reglas de seguridad.`],
      ['Abre un PR', `Que sea concreto, ejecuta <code>npm run typecheck</code> y <code>npm test</code>, y sigue ${CONTRIBUTING}.`],
    ],
    copyCommand: 'Copiar comando',
    limits: 'Limitaciones conocidas',
  },
  client: { item: 'punto', items: 'puntos' },
};

const eu: RoadmapContent = {
  meta: {
    title: 'Adarren bide-orria — adarrak nora hazten diren',
    description: 'Adarren kode irekiko bide-orria: zer atera den, zer datorren, laguntzaileen zain dauden «good first issue»-ak eta berritasun guztiak.',
    ogTitle: 'Adarren bide-orria',
    ogDescription: 'Nora doan Adar, zer atera den eta nola lagundu.',
  },
  hero: {
    eyebrow: 'Bide-orri irekia',
    title: 'Nora <span class="serif">hazten den Adar.</span>',
    lede: `Lehentasunak iritzien arabera aldatzen dira: ireki issue bat puntu bat eztabaidatzeko, bozkatu 👍-rekin dauden issue-ak edo hartu zerbait zeure gain. ${gfi} markatutako puntuak txikiak eta beregainak dira.`,
    showGfi: 'Ikusi good first issue-ak', suggest: 'Proposatu ideia bat',
    stats: ['Planifikatuta', 'Good first issue', 'Arloak', 'Bertsioak'],
    fig: '<span>5. irud.</span> git log --graph --all · etortzeko dauden adarrak',
  },
  principlesTitle: 'Printzipioak',
  principles: [
    { title: 'Edozein biltegirekin dabil.', text: 'Adarrek erabiltzailearen git-a eta kredentzialak erabiltzen ditu; konturik eta loturarik gabe.' },
    { title: 'Azkarra biltegi handietan.', text: 'Ezaugarri orok arin ibili behar du 100.000 commit baino gehiagorekin eta milaka ref-ekin.' },
    { title: 'Segurua berez.', text: 'Eragiketa suntsitzaileak berresten dira eta, ahal den guztietan, desegin daitezke.' },
    { title: 'Pribatua berez.', text: 'Telemetriarik ez. Hirugarrenen zerbitzu batekin hitz egiten duen guztia aukerakoa da.' },
  ],
  bar: { show: 'Erakutsi', filters: ['Dena', 'Hurrengoa', 'Geroago', 'Argitaratua'], gfi: 'Good first issue', search: 'Iragazi bide-orria…' },
  englishNote: 'Bide-orriko puntuak eta bertsio-oharrak ingelesez idazten dira biltegian.',
  graph: {
    listLabel: 'Bide-orria',
    shipped: (version: string) => `${version} bertsioan argitaratua`, features: 'ezaugarri',
    here: 'Hemen zaude', hereAria: 'Hemen zaude',
    kinds: { next: 'hurrengoa', later: 'geroago', shipped: 'argitaratua' },
    titles: { next: 'Hurrengoa', later: 'Geroago' },
    items: 'puntu', discuss: 'Eztabaidatu', done: 'eginda',
    empty: `Ezerk ez du bat egiten iragazki horrekin: saiatu beste hitz batekin edo <a class="link" href="${ISSUES}/new/choose">proposatu</a>.`,
  },
  changelog: {
    eyebrow: 'Berritasunak',
    title: 'Bertsio bakoitza, <span class="serif">commitez commit.</span>',
    text: 'Zuzenean GitHub Releases-etik: aplikazioaren eguneratzaileak «What’s new» atalean erakusten dituen ohar berberak.',
    latest: 'Azkena', prerelease: 'Aurre-bertsioa', link: 'Bertsioaren orria eta deskargak',
    none: `Ikusi <a class="link" href="https://github.com/mikelgarciaurbina/adar/releases">bertsio guztiak GitHub-en</a>.`,
  },
  contribute: {
    eyebrow: 'Lagundu',
    title: 'Aukeratu adar bat. <span class="serif">Hazi ezazu.</span>',
    text: 'Adar nahikoa txikia da pull request bakar batek alda dezan. Hau da ideiatik merge-ra bide laburrena.',
    steps: [
      ['Aukeratu', `Hartu ${gfiButton('good first issue')} bat edo <a class="link" href="${ISSUES}">irekita dagoen issue bat</a>. Esan horretan ari zarela, inork lana bikoiztu ez dezan.`],
      ['Prestatu', ''],
      ['Irakurri mapa', `${AGENTS} fitxategiak arkitektura, konbentzioak eta segurtasun-arauak azaltzen ditu.`],
      ['Ireki PR bat', `Mantendu zehatza, exekutatu <code>npm run typecheck</code> eta <code>npm test</code>, eta jarraitu ${CONTRIBUTING}.`],
    ],
    copyCommand: 'Kopiatu komandoa',
    limits: 'Muga ezagunak',
  },
  client: { item: 'puntu', items: 'puntu' },
};

export const roadmap: Record<Locale, RoadmapContent> = { en, es, eu };

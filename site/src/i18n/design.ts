// Basoa design system page copy. Strings may contain trusted inline HTML (set:html).
import type { Locale } from './config';

type Section = 'principles' | 'logo' | 'color' | 'type' | 'space' | 'motion' | 'icons' | 'graph' | 'components' | 'voice' | 'story' | 'downloads';

const en = {
  meta: {
    title: 'Basoa — the Adar design system',
    description: 'Basoa is Adar’s open design system: the antler-and-branch logo, a palette named after the Basque forest, type, motion, icons, components and the visual language of the commit graph.',
    ogDescription: 'Logo, colour, type, motion, icons and components behind Adar. Open and free to reuse.',
  },
  hero: {
    eyebrow: 'Design system · v1',
    lede: '<i lang="eu">Basoa</i> is Basque for <b>forest</b> — where branches, antlers and moss live. It is the visual language of Adar: one mark, a palette named after the woods at night, three typefaces and a graph that everything else grows from.',
    assets: 'Get the assets',
    markAria: 'The Adar mark, extruded in 3D',
    fig: '<span>fig. 6</span> the mark, extruded — drag to turn it',
  },
  toc: 'Contents', tocAria: 'On this page',
  ids: { principles: 'principles', logo: 'logo', color: 'color', type: 'type', space: 'space', motion: 'motion', icons: 'icons', graph: 'graph', components: 'components', voice: 'voice', story: 'story', downloads: 'downloads' } as Record<Section, string>,
  nav: { principles: 'Principles', logo: 'Logo', color: 'Colour', type: 'Typography', space: 'Space &amp; shape', motion: 'Motion', icons: 'Icons', graph: 'Graph language', components: 'Components', voice: 'Voice', story: 'Story', downloads: 'Downloads' } as Record<Section, string>,
  principles: [
    ['Grown, not built.', 'Shapes branch and taper like living things. Curves are soft, ends are round, nothing is boxy for its own sake.'],
    ['The history is the hero.', 'The commit graph is the most important picture. Colour, glow and motion exist to make it readable.'],
    ['Calm until it matters.', 'Night-dark surfaces and fog-grey text; fern only where the eye should go. One accent per view.'],
    ['Basque at heart, open to all.', 'Names and small details come from euskara; the website speaks English, Spanish and Basque, and the app will too.'],
  ],
  logo: {
    text: 'A pair of antlers drawn with git lanes. A root commit, one fork, two beams and two tines — and a commit at every tip. Read it as a deer, a branching tree or <code>git log --graph</code>: all three are <i lang="eu">adar</i>.',
    constructTitle: 'Construction of the Adar mark on a 64 unit grid',
    labels: ['root commit', 'fork', 'beam · main', 'commit', 'tine · feature', 'stroke 4.6 / 64', 'node r 5.4 · tips 4.4'],
    caption: 'Drawn on a 64-unit grid with a single 4.6-unit round stroke. Tips are 4.4-unit commits; the root is slightly larger. Everything is symmetric about the centre lane.',
    cards: [['Lockup · night', 'Adar lockup on night'], ['Lockup · day', 'Adar lockup on day'], ['Mark · on fern', 'Adar mark on fern'], ['Tile · favicon &amp; app', 'Adar app tile']],
    clear: ['Clear space', 'Keep one tip-node (¼ of the mark) free on every side.'],
    min: ['Minimum size', 'Mark from 16 px, lockup from 24 px tall.'],
    dont: ['Don’t', 'Keep the mark upright, in proportion, in fern, ink or bone.', ['rotate', 'stretch', 'recolour', 'add effects']],
  },
  color: {
    text: 'Every colour is named in Basque after something in the forest. Night surfaces carry the interface; the accents are used sparingly and always mean the same thing. Click a swatch to copy it.',
    neutrals: 'Neutrals', semantic: 'Semantic tokens', head: ['Token', 'Role', 'Night', 'Day'],
  },
  type: {
    text: 'Geist does the work, Instrument Serif brings the feeling, Geist Mono labels the machine. Use the serif italic for one or two words per heading — never for whole paragraphs.',
    faces: ['Interface, headings and body text. Tight tracking on large sizes.', 'Expressive words in headlines, Basque terms, figure captions.', 'Code, SHAs, refs, keyboard shortcuts and eyebrow labels.'],
    italic: 'Italic',
    scale: ['See your <span class="serif accent">git</span>', 'Pick a branch.', 'Merge feature/login into main', 'Stage files, hunks or single lines.', 'Adar drives the git already installed on your Mac, so it works with the credentials you already use.', 'Destructive actions ask first and can be undone.'],
  },
  space: {
    title: 'Space, shape &amp; depth',
    text: 'A 4 px grid, generous radii and light that comes from the content — glows, not heavy drop shadows.',
    cards: ['Spacing', 'Radius', 'Depth &amp; glow'],
  },
  motion: {
    text: 'Things <i lang="eu">hazi</i> (grow) into place: quick to start, slow to settle. Motion follows the direction of history, stops for people who ask for reduced motion, and every loop can be paused from the floating button in the corner.',
    durations: ['Hover, press, colour changes.', 'Toggles, menus, small moves.', 'Panels, cards, notes appearing.', 'Reveals and lanes drawing themselves.'],
  },
  icons: { text: 'A 24 px grid with 1.75 px round strokes, drawn to sit next to the mark. The app itself uses Lucide; these are the website’s. Click an icon to copy its <code>&lt;use&gt;</code> snippet.', copy: 'Copy' },
  graph: {
    text: 'The same vocabulary draws the app’s commit graph, the roadmap and the logo. Lanes take colours in a fixed order, so a branch keeps its colour wherever it appears.',
    title: 'Graph vocabulary: lanes, commit, merge, work in progress, head and root',
    labels: ['HEAD — filled, glowing: where you are', '// WIP — dashed ring: not committed yet', 'merge — small filled dot on the target lane', 'commit — ring in its lane colour', 'planned — dashed lane (roadmap)', 'root — the first commit, bottom of the trunk'],
  },
  components: {
    text: 'The building blocks of the website, each built only from tokens. Flip the preview to see them by day.',
    theme: 'Theme', night: 'Gaua · night', day: 'Eguna · day',
    labels: ['Buttons', 'Refs', 'Chips &amp; keys', 'Code', 'Card'],
    buttons: ['Primary', 'Default', 'Ghost', 'Large', 'meta'],
    chip: 'New',
    copyCommand: 'Copy command',
    card: ['Eyebrow', 'A card <span class="serif accent">grows</span>', 'Surface, hairline border, a faint top light.'],
  },
  voice: {
    text: 'Plain words, short sentences, and the real git name for things. Say what will happen before it happens.',
    do: 'Do', dont: 'Don’t',
    good: ['Merge <b>feature/login</b> into <b>main</b>', 'This branch was already pushed. Saving rewrites it on the remote.', 'Undid “Delete branch experiment”'],
    bad: ['Execute merge operation on selected references', 'Warning! Are you absolutely sure?', 'Oops! Something went wrong 😅'],
  },
  story: {
    text: 'The story is what makes Adar different. In Basque one word, <i lang="eu">adar</i>, names a tree’s branch and a deer’s antler, and a git branch grows the same way. The website tells it as one night in the forest, from dark to dawn, and every chapter pairs a Basque word with a part of the product.',
    head: ['#', 'Euskara', 'Meaning', 'In the forest', 'In Adar'],
    rules: [
      ['The story frames, the product sells.', 'One sentence of forest, then a literal headline about what Adar does.'],
      ['Only true images.', 'Deer really shed their antlers every year; trees really add a ring a year. If it isn’t true in the forest, it doesn’t go in.'],
      ['Basque first, then its meaning.', 'Basque words in the serif italic, marked <code>lang="eu"</code>, with their meaning in the page’s language beside them.'],
      ['Never rename git.', 'Branches, commits and rebases keep their names; the metaphor lives in captions and chapter titles.'],
      ['Imply the deer.', 'Its antlers are enough: no illustrated deer, leaves or wood textures in the interface.'],
      ['Night to dawn.', 'Light grows as the story moves on, and the download is at dawn.'],
    ],
  },
  downloads: {
    text: 'Everything is MIT-licensed with the rest of Adar. Use it for articles, talks, forks and integrations — just don’t present a fork as the official Adar.',
    items: ['Mark', 'Mark · ink', 'Lockup · night', 'Lockup · day', 'App tile', 'Icon sprite', 'Design tokens', 'Fonts'],
  },
  client: {
    swatches: [
      ['Fern', 'The brand colour: calls to action, focus, the main branch.'],
      ['Moss', 'Success, additions, staged changes.'],
      ['Sea', 'Information, remotes, links between things.'],
      ['Heather', 'Rewriting history: rebase, squash, experiments.'],
      ['Ember', 'Danger, deletions, conflicts.'],
      ['Sun', 'Warnings, tags, good first issues.'],
      ['Bone', 'Antlers, illustration, highlights on night.'],
    ],
    ramps: ['Gaua · night', 'Lainoa · fog', 'Eguna · day'],
    roles: ['Page background', 'Cards and panels', 'Raised controls', 'Hairline borders', 'Headings, primary text', 'Body text', 'Secondary text', 'Primary actions', 'Accent text and links', 'Success', 'Information', 'Warning', 'Danger'],
    curves: [
      ['grow', 'Entrances, reveals, lanes drawing — fast start, long settle.'],
      ['change', 'Moving between two states, loops, toggles.'],
      ['jump', 'Small pops: nodes appearing, switches, badges.'],
    ],
    lanes: ['main', 'feature', 'remote', 'rewrite', 'hotfix', 'release'],
  },
};

export type DesignContent = typeof en;

const es: DesignContent = {
  meta: {
    title: 'Basoa — el sistema de diseño de Adar',
    description: 'Basoa es el sistema de diseño abierto de Adar: el logo de cornamenta y ramas, una paleta con nombres del bosque vasco, tipografía, movimiento, iconos, componentes y el lenguaje visual del grafo de commits.',
    ogDescription: 'El logo, los colores, la tipografía, el movimiento, los iconos y los componentes de Adar. Abierto y libre para reutilizar.',
  },
  hero: {
    eyebrow: 'Sistema de diseño · v1',
    lede: '<i lang="eu">Basoa</i> significa <b>bosque</b> en euskera: donde viven las ramas, las cornamentas y el musgo. Es el lenguaje visual de Adar: un símbolo, una paleta con nombres del bosque de noche, tres tipografías y un grafo del que crece todo lo demás.',
    assets: 'Descargar los recursos',
    markAria: 'El símbolo de Adar, extruido en 3D',
    fig: '<span>fig. 6</span> el símbolo, extruido — arrástralo para girarlo',
  },
  toc: 'Contenido', tocAria: 'En esta página',
  ids: { principles: 'principios', logo: 'logo', color: 'color', type: 'tipografia', space: 'espacio', motion: 'movimiento', icons: 'iconos', graph: 'grafo', components: 'componentes', voice: 'voz', story: 'historia', downloads: 'descargas' },
  nav: { principles: 'Principios', logo: 'Logo', color: 'Color', type: 'Tipografía', space: 'Espacio y forma', motion: 'Movimiento', icons: 'Iconos', graph: 'Lenguaje del grafo', components: 'Componentes', voice: 'Voz', story: 'Historia', downloads: 'Descargas' },
  principles: [
    ['Crecido, no construido.', 'Las formas se ramifican y se afinan como algo vivo. Las curvas son suaves, los extremos redondos y nada es cuadrado porque sí.'],
    ['La historia es la protagonista.', 'El grafo de commits es la imagen más importante. El color, el brillo y el movimiento existen para que se lea mejor.'],
    ['Calma hasta que importa.', 'Superficies oscuras como la noche y texto gris niebla; el helecho solo donde debe ir la vista. Un acento por vista.'],
    ['Vasco de corazón, abierto a todos.', 'Los nombres y los pequeños detalles vienen del euskera; la web habla inglés, castellano y euskera, y la app lo hará también.'],
  ],
  logo: {
    text: 'Una cornamenta dibujada con carriles de git. Un commit raíz, una bifurcación, dos ramas y dos puntas, y un commit en cada extremo. Puedes leerlo como un ciervo, como un árbol que se ramifica o como <code>git log --graph</code>: las tres cosas son <i lang="eu">adar</i>.',
    constructTitle: 'Construcción del símbolo de Adar sobre una retícula de 64 unidades',
    labels: ['commit raíz', 'bifurcación', 'rama · main', 'commit', 'punta · feature', 'trazo 4,6 / 64', 'nodo r 5,4 · puntas 4,4'],
    caption: 'Dibujado sobre una retícula de 64 unidades con un único trazo redondo de 4,6. Las puntas son commits de 4,4 unidades; la raíz es algo mayor. Todo es simétrico respecto al carril central.',
    cards: [['Logotipo · noche', 'Logotipo de Adar sobre fondo de noche'], ['Logotipo · día', 'Logotipo de Adar sobre fondo de día'], ['Símbolo · sobre helecho', 'Símbolo de Adar sobre helecho'], ['Icono · favicon y app', 'Icono de la app Adar']],
    clear: ['Espacio de respeto', 'Deja libre a cada lado el tamaño de un nodo de punta (¼ del símbolo).'],
    min: ['Tamaño mínimo', 'El símbolo desde 16 px y el logotipo desde 24 px de alto.'],
    dont: ['No hagas', 'Mantén el símbolo derecho, proporcionado y en helecho, tinta o hueso.', ['girarlo', 'estirarlo', 'recolorearlo', 'añadir efectos']],
  },
  color: {
    text: 'Cada color tiene un nombre en euskera tomado del bosque. Las superficies de noche sostienen la interfaz; los acentos se usan con mesura y siempre significan lo mismo. Haz clic en una muestra para copiarla.',
    neutrals: 'Neutros', semantic: 'Tokens semánticos', head: ['Token', 'Uso', 'Noche', 'Día'],
  },
  type: {
    text: 'Geist hace el trabajo, Instrument Serif pone el sentimiento y Geist Mono etiqueta la máquina. Usa la serif cursiva para una o dos palabras por titular, nunca para párrafos enteros.',
    faces: ['Interfaz, titulares y texto. Interletraje ajustado en tamaños grandes.', 'Palabras expresivas en titulares, términos en euskera, pies de figura.', 'Código, SHAs, refs, atajos de teclado y etiquetas.'],
    italic: 'Cursiva',
    scale: ['Mira tu <span class="serif accent">git</span>', 'Elige una rama.', 'Merge feature/login into main', 'Prepara archivos, bloques o líneas sueltas.', 'Adar usa el git que ya tienes instalado en tu Mac, así que funciona con las credenciales que ya usas.', 'Las acciones destructivas preguntan antes y se pueden deshacer.'],
  },
  space: {
    title: 'Espacio, forma y profundidad',
    text: 'Una retícula de 4 px, radios generosos y una luz que sale del contenido: brillos, no sombras pesadas.',
    cards: ['Espaciado', 'Radio', 'Profundidad y brillo'],
  },
  motion: {
    text: 'Las cosas <i lang="eu">hazi</i> (crecen) hasta su sitio: arrancan rápido y se asientan despacio. El movimiento sigue la dirección de la historia, se detiene para quien pide reducir el movimiento, y cualquier bucle se puede pausar con el botón flotante de la esquina.',
    durations: ['Hover, pulsaciones, cambios de color.', 'Interruptores, menús, movimientos pequeños.', 'Paneles, tarjetas, notas que aparecen.', 'Apariciones y carriles que se dibujan solos.'],
  },
  icons: { text: 'Una retícula de 24 px con trazos redondos de 1,75 px, dibujados para convivir con el símbolo. La app usa Lucide; estos son los de la web. Haz clic en un icono para copiar su <code>&lt;use&gt;</code>.', copy: 'Copiar' },
  graph: {
    text: 'El mismo vocabulario dibuja el grafo de commits de la app, la hoja de ruta y el logo. Los carriles toman los colores en un orden fijo, así que una rama conserva su color allí donde aparece.',
    title: 'Vocabulario del grafo: carriles, commit, merge, trabajo en curso, HEAD y raíz',
    labels: ['HEAD — relleno y brillante: dónde estás', '// WIP — anillo discontinuo: aún sin commit', 'merge — punto pequeño en el carril de destino', 'commit — anillo del color de su carril', 'planeado — carril discontinuo (hoja de ruta)', 'raíz — el primer commit, al pie del tronco'],
  },
  components: {
    text: 'Las piezas de la web, cada una hecha solo con tokens. Cambia la vista previa para verlas de día.',
    theme: 'Tema', night: 'Gaua · noche', day: 'Eguna · día',
    labels: ['Botones', 'Refs', 'Chips y teclas', 'Código', 'Tarjeta'],
    buttons: ['Principal', 'Normal', 'Fantasma', 'Grande', 'meta'],
    chip: 'Nuevo',
    copyCommand: 'Copiar comando',
    card: ['Antetítulo', 'Una tarjeta <span class="serif accent">crece</span>', 'Superficie, borde fino y una luz suave arriba.'],
  },
  voice: {
    text: 'Palabras sencillas, frases cortas y el nombre real de las cosas en git. Di lo que va a pasar antes de que pase.',
    do: 'Sí', dont: 'No',
    good: ['Hacer merge de <b>feature/login</b> en <b>main</b>', 'Esta rama ya estaba subida. Al guardar se reescribe en el remoto.', 'Deshecho «Borrar la rama experiment»'],
    bad: ['Ejecutar la operación de fusión sobre las referencias seleccionadas', '¡Atención! ¿Estás completamente seguro?', '¡Ups! Algo ha salido mal 😅'],
  },
  story: {
    text: 'La historia es lo que hace diferente a Adar. En euskera una sola palabra, <i lang="eu">adar</i>, nombra la rama de un árbol y la cuerna de un ciervo, y una rama de git crece igual. La web lo cuenta como una noche en el bosque, de la oscuridad al amanecer, y cada capítulo une una palabra en euskera con una parte del producto.',
    head: ['#', 'Euskera', 'Significado', 'En el bosque', 'En Adar'],
    rules: [
      ['La historia enmarca, el producto vende.', 'Una frase de bosque y después un titular literal sobre lo que hace Adar.'],
      ['Solo imágenes verdaderas.', 'Los ciervos mudan la cornamenta cada año y los árboles suman un anillo al año. Si no es verdad en el bosque, no entra.'],
      ['Primero el euskera, luego su significado.', 'Las palabras en euskera, en la serif cursiva y marcadas con <code>lang="eu"</code>, con su significado en el idioma de la página al lado.'],
      ['Nunca renombres git.', 'Ramas, commits y rebases conservan su nombre; la metáfora vive en los pies de figura y en los títulos de capítulo.'],
      ['Sugiere el ciervo.', 'Su cornamenta basta: nada de ciervos ilustrados, hojas ni texturas de madera en la interfaz.'],
      ['De la noche al amanecer.', 'La luz crece a medida que avanza la historia, y la descarga está al amanecer.'],
    ],
  },
  downloads: {
    text: 'Todo tiene licencia MIT, como el resto de Adar. Úsalo en artículos, charlas, forks e integraciones; solo no presentes un fork como el Adar oficial.',
    items: ['Símbolo', 'Símbolo · tinta', 'Logotipo · noche', 'Logotipo · día', 'Icono de la app', 'Sprite de iconos', 'Tokens de diseño', 'Tipografías'],
  },
  client: {
    swatches: [
      ['Helecho', 'El color de la marca: llamadas a la acción, foco, la rama principal.'],
      ['Musgo', 'Éxito, añadidos, cambios preparados.'],
      ['Mar', 'Información, remotos, vínculos entre cosas.'],
      ['Brezo', 'Reescribir la historia: rebase, squash, experimentos.'],
      ['Ascua', 'Peligro, borrados, conflictos.'],
      ['Sol', 'Avisos, tags, good first issues.'],
      ['Hueso', 'Cornamentas, ilustración, destellos sobre la noche.'],
    ],
    ramps: ['Gaua · noche', 'Lainoa · niebla', 'Eguna · día'],
    roles: ['Fondo de la página', 'Tarjetas y paneles', 'Controles elevados', 'Bordes finos', 'Titulares, texto principal', 'Texto', 'Texto secundario', 'Acciones principales', 'Texto de acento y enlaces', 'Éxito', 'Información', 'Aviso', 'Peligro'],
    curves: [
      ['crecer', 'Entradas, apariciones, carriles que se dibujan: arranque rápido, final largo.'],
      ['cambiar', 'Pasar de un estado a otro, bucles, interruptores.'],
      ['saltar', 'Pequeños saltos: nodos que aparecen, interruptores, insignias.'],
    ],
    lanes: ['main', 'feature', 'remoto', 'reescritura', 'hotfix', 'release'],
  },
};

const eu: DesignContent = {
  meta: {
    title: 'Basoa — Adarren diseinu-sistema',
    description: 'Basoa Adarren diseinu-sistema irekia da: adarrez eta oreinaren adarrez egindako logoa, euskal basoaren izenak dituen paleta, tipografia, mugimendua, ikonoak, osagaiak eta commit grafoaren hizkera bisuala.',
    ogDescription: 'Adarren logoa, koloreak, tipografia, mugimendua, ikonoak eta osagaiak. Irekiak eta berrerabiltzeko libre.',
  },
  hero: {
    eyebrow: 'Diseinu-sistema · v1',
    lede: '<i lang="eu">Basoa</i> adarrak, oreinak eta goroldioa bizi diren lekua da. Adarren hizkera bisuala da: ikur bat, gaueko basoaren izenak dituen paleta bat, hiru tipografia eta beste guztia hazten den grafo bat.',
    assets: 'Deskargatu baliabideak',
    markAria: 'Adarren ikurra, 3Dn estrusionatuta',
    fig: '<span>6. irud.</span> ikurra, estrusionatuta — arrastatu biratzeko',
  },
  toc: 'Edukia', tocAria: 'Orri honetan',
  ids: { principles: 'printzipioak', logo: 'logoa', color: 'kolorea', type: 'tipografia', space: 'espazioa', motion: 'mugimendua', icons: 'ikonoak', graph: 'grafoa', components: 'osagaiak', voice: 'ahotsa', story: 'istorioa', downloads: 'deskargak' },
  nav: { principles: 'Printzipioak', logo: 'Logoa', color: 'Kolorea', type: 'Tipografia', space: 'Espazioa eta forma', motion: 'Mugimendua', icons: 'Ikonoak', graph: 'Grafoaren hizkera', components: 'Osagaiak', voice: 'Ahotsa', story: 'Istorioa', downloads: 'Deskargak' },
  principles: [
    ['Hazia, ez eraikia.', 'Formak bizidunak bezala adarkatzen eta mehetzen dira. Kurbak leunak dira, muturrak biribilak, eta ezer ez da koadroa koadro izateagatik.'],
    ['Historia da protagonista.', 'Commit grafoa da irudirik garrantzitsuena. Kolorea, distira eta mugimendua hura hobeto irakurtzeko daude.'],
    ['Lasai, garrantzitsua den arte.', 'Gaua bezain ilunak diren gainazalak eta laino-koloreko testua; iratzea begiak joan behar duen lekuan bakarrik. Azentu bat ikuspegi bakoitzeko.'],
    ['Bihotzez euskalduna, guztientzat irekia.', 'Izenak eta xehetasun txikiak euskaratik datoz; webguneak ingelesez, gaztelaniaz eta euskaraz hitz egiten du, eta aplikazioak ere hala egingo du.'],
  ],
  logo: {
    text: 'Git erreiekin marraztutako orein-adar pare bat. Erro-commit bat, adarkatze bat, bi adar nagusi eta bi punta, eta commit bat mutur bakoitzean. Orein gisa, adarkatzen den zuhaitz gisa edo <code>git log --graph</code> gisa irakur daiteke: hirurak dira <i lang="eu">adar</i>.',
    constructTitle: 'Adarren ikurraren eraikuntza 64 unitateko sareta batean',
    labels: ['erro-commita', 'adarkatzea', 'adar nagusia · main', 'commita', 'punta · feature', 'marra 4,6 / 64', 'nodoa r 5,4 · puntak 4,4'],
    caption: '64 unitateko sareta batean marraztua, 4,6 unitateko marra biribil bakar batekin. Puntak 4,4 unitateko commitak dira; erroa apur bat handiagoa da. Dena da simetrikoa erdiko errearekiko.',
    cards: [['Logotipoa · gaua', 'Adarren logotipoa gaueko hondoan'], ['Logotipoa · eguna', 'Adarren logotipoa eguneko hondoan'], ['Ikurra · iratze gainean', 'Adarren ikurra iratze-kolorearen gainean'], ['Ikonoa · favicon eta aplikazioa', 'Adar aplikazioaren ikonoa']],
    clear: ['Errespetu-tartea', 'Utzi alde bakoitzean punta-nodo baten tamaina (ikurraren ¼) hutsik.'],
    min: ['Gutxieneko tamaina', 'Ikurra 16 px-tik aurrera, logotipoa 24 px-eko altueratik aurrera.'],
    dont: ['Ez egin', 'Eduki ikurra zuzen, proportzioan eta iratze-, tinta- edo hezur-kolorean.', ['biratu', 'luzatu', 'koloreztatu', 'efektuak gehitu']],
  },
  color: {
    text: 'Kolore bakoitzak basoko zerbaiten euskal izena du. Gaueko gainazalek eusten diote interfazeari; azentuak neurriz erabiltzen dira eta beti gauza bera esan nahi dute. Egin klik lagin batean kopiatzeko.',
    neutrals: 'Neutroak', semantic: 'Token semantikoak', head: ['Tokena', 'Erabilera', 'Gaua', 'Eguna'],
  },
  type: {
    text: 'Geist-ek egiten du lana, Instrument Serif-ek jartzen du sentimendua eta Geist Mono-k etiketatzen du makina. Erabili serif etzana izenburu bakoitzeko hitz bat edo bitarako, inoiz ez paragrafo osoetarako.',
    faces: ['Interfazea, izenburuak eta testua. Letra-tarte estua tamaina handietan.', 'Izenburuetako hitz adierazkorrak, euskal terminoak, irudi-oinak.', 'Kodea, SHAk, ref-ak, laster-teklak eta etiketak.'],
    italic: 'Etzana',
    scale: ['Ikusi zure <span class="serif accent">git-a</span>', 'Aukeratu adar bat.', 'Merge feature/login into main', 'Prestatu fitxategiak, zatiak edo lerro solteak.', 'Adarrek zure Mac-ean instalatuta dagoen git-a erabiltzen du, beraz dagoeneko erabiltzen dituzun kredentzialekin dabil.', 'Ekintza suntsitzaileek lehenago galdetzen dute eta desegin daitezke.'],
  },
  space: {
    title: 'Espazioa, forma eta sakonera',
    text: '4 px-eko sareta, erradio eskuzabalak eta edukitik datorren argia: distirak, ez itzal astunak.',
    cards: ['Tarteak', 'Erradioa', 'Sakonera eta distira'],
  },
  motion: {
    text: 'Gauzak beren lekura <i lang="eu">hazten</i> dira: azkar abiatu eta poliki finkatu. Mugimenduak historiaren norabideari jarraitzen dio, mugimendu gutxiago eskatzen dutenentzat gelditzen da, eta begizta oro izkinako botoi flotatzailearekin pausa daiteke.',
    durations: ['Hover-a, sakatzeak, kolore-aldaketak.', 'Etengailuak, menuak, mugimendu txikiak.', 'Panelak, txartelak, agertzen diren oharrak.', 'Agerpenak eta beren kabuz marrazten diren erreiak.'],
  },
  icons: { text: '24 px-eko sareta, 1,75 px-eko marra biribilekin, ikurraren ondoan egoteko marraztua. Aplikazioak Lucide erabiltzen du; hauek webgunearenak dira. Egin klik ikono batean bere <code>&lt;use&gt;</code> kopiatzeko.', copy: 'Kopiatu' },
  graph: {
    text: 'Hiztegi berak marrazten ditu aplikazioaren commit grafoa, bide-orria eta logoa. Erreiek kolore-ordena finko bat dute, beraz adar batek bere kolorea gordetzen du agertzen den leku guztietan.',
    title: 'Grafoaren hiztegia: erreiak, commita, merge-a, bidean dagoen lana, HEAD-a eta erroa',
    labels: ['HEAD — betea eta distiratsua: non zauden', '// WIP — eraztun etena: oraindik commit gabe', 'merge — puntu txiki betea helburuko errean', 'commit — bere erreiaren koloreko eraztuna', 'planifikatua — erreia etena (bide-orria)', 'erroa — lehen commita, enborraren oinean'],
  },
  components: {
    text: 'Webgunearen piezak, bakoitza tokenekin bakarrik egina. Aldatu aurrebista egunez ikusteko.',
    theme: 'Gaia', night: 'Gaua', day: 'Eguna',
    labels: ['Botoiak', 'Ref-ak', 'Txipak eta teklak', 'Kodea', 'Txartela'],
    buttons: ['Nagusia', 'Arrunta', 'Mamua', 'Handia', 'meta'],
    chip: 'Berria',
    copyCommand: 'Kopiatu komandoa',
    card: ['Aurretitulua', 'Txartel bat <span class="serif accent">hazten da</span>', 'Gainazala, ertz fina eta goiko argi leun bat.'],
  },
  voice: {
    text: 'Hitz arruntak, esaldi laburrak eta gauzen benetako izena git-en. Esan zer gertatuko den gertatu aurretik.',
    do: 'Bai', dont: 'Ez',
    good: ['Egin merge: <b>feature/login</b> → <b>main</b>', 'Adar hau dagoeneko igota zegoen. Gordetzean urrunekoan berridatziko da.', 'Desegina: «Ezabatu experiment adarra»'],
    bad: ['Exekutatu bateratze-eragiketa hautatutako erreferentzien gainean', 'Kontuz! Guztiz ziur zaude?', 'Ups! Zerbait gaizki atera da 😅'],
  },
  story: {
    text: 'Istorioa da Adar desberdin egiten duena. Euskaraz hitz bakar batek, <i lang="eu">adar</i>-ek, izendatzen ditu zuhaitzaren adarra eta oreinaren adarra, eta git adar bat ere horrela hazten da. Webguneak basoko gau bat bezala kontatzen du, iluntasunetik egunsentira, eta kapitulu bakoitzak euskal hitz bat produktuaren zati batekin lotzen du.',
    head: ['#', 'Euskara', 'Esanahia', 'Basoan', 'Adarren'],
    rules: [
      ['Istorioak markoa jartzen du, produktuak saltzen du.', 'Basoko esaldi bat, eta gero Adarrek egiten duenari buruzko izenburu literal bat.'],
      ['Irudi egiazkoak bakarrik.', 'Oreinek urtero botatzen dituzte adarrak, eta zuhaitzek urtero gehitzen dute eraztun bat. Basoan egia ez bada, ez da sartzen.'],
      ['Lehenik euskara, gero esanahia.', 'Euskal hitzak serif etzanean, <code>lang="eu"</code> markarekin, eta ondoan orriaren hizkuntzako esanahia.'],
      ['Ez aldatu inoiz git-en izenik.', 'Adarrek, commitek eta rebaseek beren izena gordetzen dute; metafora irudi-oinetan eta kapitulu-izenburuetan bizi da.'],
      ['Iradoki oreina.', 'Haren adarrak nahikoa dira: ez marraztutako oreinik, ez hostorik, ez egur-testurarik interfazean.'],
      ['Gauetik egunsentira.', 'Argia hazi egiten da istorioak aurrera egin ahala, eta deskarga egunsentian dago.'],
    ],
  },
  downloads: {
    text: 'Dena MIT lizentziapean dago, Adarren gainerakoa bezala. Erabili artikuluetan, hitzaldietan, fork-etan eta integrazioetan; ez aurkeztu, ordea, fork bat Adar ofizial gisa.',
    items: ['Ikurra', 'Ikurra · tinta', 'Logotipoa · gaua', 'Logotipoa · eguna', 'Aplikazioaren ikonoa', 'Ikono-sprite-a', 'Diseinu-tokenak', 'Tipografiak'],
  },
  client: {
    swatches: [
      ['', 'Markaren kolorea: ekintzarako deiak, fokua, adar nagusia.'],
      ['', 'Arrakasta, gehikuntzak, prestatutako aldaketak.'],
      ['', 'Informazioa, urrunekoak, gauzen arteko loturak.'],
      ['', 'Historia berridaztea: rebase-a, squash-a, esperimentuak.'],
      ['', 'Arriskua, ezabaketak, gatazkak.'],
      ['', 'Abisuak, etiketak, good first issue-ak.'],
      ['', 'Adarrak, ilustrazioa, gaueko distirak.'],
    ],
    ramps: ['Gaua', 'Lainoa', 'Eguna'],
    roles: ['Orriaren hondoa', 'Txartelak eta panelak', 'Kontrol altxatuak', 'Ertz finak', 'Izenburuak, testu nagusia', 'Testua', 'Bigarren mailako testua', 'Ekintza nagusiak', 'Azentu-testua eta estekak', 'Arrakasta', 'Informazioa', 'Abisua', 'Arriskua'],
    curves: [
      ['', 'Sarrerak, agerpenak, marrazten diren erreiak: abiatze azkarra, amaiera luzea.'],
      ['', 'Egoera batetik bestera igarotzea, begiztak, etengailuak.'],
      ['', 'Jauzi txikiak: agertzen diren nodoak, etengailuak, txapak.'],
    ],
    lanes: ['main', 'feature', 'urrunekoa', 'berridazketa', 'hotfix', 'release'],
  },
};

export const design: Record<Locale, DesignContent> = { en, es, eu };
export const SECTIONS: Section[] = ['principles', 'logo', 'color', 'type', 'space', 'motion', 'icons', 'graph', 'components', 'voice', 'story', 'downloads'];

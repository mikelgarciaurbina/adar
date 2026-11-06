// "Adar + AI agents" page copy in English, Spanish and Basque: how Adar fits working with coding agents, step by
// step, with only what Adar already does. Strings may contain trusted inline HTML (set:html). The app's own words
// (menus, buttons) stay English, as its interface is.
import type { Locale } from './config';

const en = {
  meta: {
    title: 'Adar with AI agents — review what they push',
    description: 'How to work with AI coding agents and Adar: one worktree per agent, what each one is doing right now, a review of only what changed since you last looked, and a ping when they push or stop.',
    ogTitle: 'Your agents write the code. You stay in the loop.',
    ogDescription: 'Adar is where you see what your AI agents did, review it, and keep up while they keep going.',
  },
  hero: {
    eyebrow: 'Adar + AI agents',
    title: 'Your agents write the code. <span class="serif">You stay in the loop.</span>',
    lede: 'Claude, Copilot, Codex or Cursor can write most of a change now. Deciding whether it is right is still yours. Adar is where you see what they did, review it, and keep up while they keep going.',
    download: 'Download Adar',
    howItWorks: 'How it works',
  },
  shot: {
    alt: 'Adar reviewing a pull request co-written by Claude: only the two commits pushed since the last review, a comment thread answered by the author, and the review panel on the right.',
    bar: 'booking-web — #42 since your review',
    notes: ['<b>Since your review</b> — only the new commits', '<b>Claude</b> co-wrote it', '<b>Threads</b> on their lines', '<b>Your review</b>, sent in one go'],
  },
  steps: {
    eyebrow: 'The loop',
    title: 'Six steps, <span class="serif">every day.</span>',
    text: 'The same loop whether one agent is fixing a bug or three are building a feature each.',
    items: [
      ['One agent, one worktree', 'Give each agent its own folder and branch, so none steps on another’s files. Make them in Adar or let your agent tool do it: each opens as a tab in the project’s group, side by side.', 'New Worktree…'],
      ['Watch them work', 'Each worktree says what its agent is doing: <i>working</i>, <i>quiet</i> — it stopped with work left and may be waiting for you — or idle, with the files changing now, on its tab, in the left panel and in the <i>Agents</i> view. A notification tells you when one commits, pushes or goes quiet, and the commits an agent co-wrote carry its name from their <code>Co-Authored-By</code> line.', 'Agents ⇧⌘E'],
      ['Review before the pull request', 'When an agent stops, <i>Review</i> on its card shows everything it did against main: its commits and what it hasn’t committed yet, with <i>Viewed</i> marks. Leave notes on lines and copy them into its chat in one go. Next round, you see only what changed since.', 'Review'],
      ['Review the pull request', 'When an agent opens a pull request, review it in Adar: the files with <i>Viewed</i> marks, lockfiles folded away, comment threads on their lines. Comment, suggest a change, request changes, and the agent reads it on GitHub, GitLab, Bitbucket or Azure DevOps. Second round? <i>Since your review</i> shows just what was pushed after it.', 'Since your review'],
      ['Know when to look', '<i>Reviews</i> lists the pull requests waiting for you, the ones you follow and yours, across every open repository. A blue dot marks what changed since you looked, and a notification tells you while you’re doing something else.', 'Reviews ⇧⌘R'],
      ['Merge, tidy up, take back', 'Merge from Adar and the branch and its worktree go in one step. If an agent reset or force-pushed what it shouldn’t have, Adar finds the lost commits in the reflog, and Undo takes back the last git action.', 'Recover Lost Commits…'],
    ],
  },
  inbox: {
    alt: 'Adar’s pull request inbox: one waiting for review, one followed with a reply and a new commit, two of the user’s own, one approved and ready to merge.',
    bar: 'Pull requests — every open repository',
    caption: 'Everything waiting for you, in one place. The blue dot is what changed since you looked.',
  },
  yours: {
    title: 'The agents get the work. <span class="serif">You keep the keys.</span>',
    text: 'Adar drives the git already on your machine, with the credentials you already use. It has no account, no servers and no telemetry, and talks to GitHub, GitLab, Bitbucket or Azure DevOps only when you turn pull requests on.',
    ticks: ['Your git and SSH keys', 'GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps', 'Every agent tool: nothing to install in them', 'Free and open source · MIT'],
  },
  next: {
    eyebrow: 'Growing next',
    tag: 'next',
    title: 'What comes next, <span class="serif">in the open.</span>',
    items: [
      ['Team view', 'A tab group at a glance: each repository’s branch and changes, colleagues’ branches by author, open pull requests and what reached main since yesterday.'],
      ['AI-authored commits in the graph', 'A mark on every commit an agent co-wrote, with a human / AI filter.'],
      ['After a force push', 'The old and the new version of a branch an agent rewrote, side by side, and what a merge’s conflict resolution changed.'],
      ['Diffs for large changes', 'A file tree with the lines added and removed, generated files folded away, whitespace changes hidden on demand, and the keyboard to go through it all.'],
    ],
    link: 'See the roadmap',
  },
  cta: {
    title: 'Try it with <span class="serif">your agents.</span>',
    text: 'Free, open source, and on the git you already have.',
    download: 'Download Adar',
    github: 'Star on GitHub',
  },
};

type AgentsCopy = typeof en;

const es: AgentsCopy = {
  meta: {
    title: 'Adar con agentes de IA: revisa lo que suben',
    description: 'Cómo trabajar con agentes de IA que programan y con Adar: un worktree por agente, qué está haciendo cada uno ahora mismo, una revisión de solo lo que ha cambiado desde que miraste y un aviso cuando suben cambios o se paran.',
    ogTitle: 'Tus agentes escriben el código. Tú sigues al mando.',
    ogDescription: 'Adar es donde ves lo que han hecho tus agentes de IA, lo revisas y te mantienes al día mientras siguen trabajando.',
  },
  hero: {
    eyebrow: 'Adar + agentes de IA',
    title: 'Tus agentes escriben el código. <span class="serif">Tú sigues al mando.</span>',
    lede: 'Claude, Copilot, Codex o Cursor ya escriben casi todo un cambio. Decidir si está bien sigue siendo cosa tuya. Adar es donde ves lo que han hecho, lo revisas y te mantienes al día mientras siguen trabajando.',
    download: 'Descargar Adar',
    howItWorks: 'Cómo funciona',
  },
  shot: {
    alt: 'Adar revisando un pull request escrito con Claude: solo los dos commits subidos desde la última revisión, un hilo de comentarios respondido por la autora y el panel de revisión a la derecha.',
    bar: 'booking-web — #42 desde tu revisión',
    notes: ['<b>Since your review</b>: solo los commits nuevos', 'Escrito con <b>Claude</b>', '<b>Hilos</b> en sus líneas', '<b>Tu revisión</b>, enviada de una vez'],
  },
  steps: {
    eyebrow: 'El ciclo',
    title: 'Seis pasos, <span class="serif">cada día.</span>',
    text: 'El mismo ciclo, tanto si un agente arregla un fallo como si tres construyen una función cada uno.',
    items: [
      ['Un agente, un worktree', 'Dale a cada agente su propia carpeta y su rama, para que ninguno pise los archivos de otro. Créalos en Adar o deja que lo haga tu herramienta de agentes: cada uno se abre como una pestaña en el grupo del proyecto, uno al lado del otro.', 'New Worktree…'],
      ['Míralos trabajar', 'Cada worktree dice qué está haciendo su agente: <i>working</i>, <i>quiet</i> —se paró con trabajo pendiente y puede estar esperándote— o inactivo, con los archivos que cambia ahora, en su pestaña, en el panel izquierdo y en la vista <i>Agents</i>. Un aviso te dice cuándo uno hace commit, sube cambios o se queda parado, y los commits que escribió un agente llevan su nombre, sacado de su línea <code>Co-Authored-By</code>.', 'Agents ⇧⌘E'],
      ['Revisa antes del pull request', 'Cuando un agente se para, <i>Review</i> en su tarjeta muestra todo lo que ha hecho frente a main: sus commits y lo que aún no ha commiteado, con marcas de <i>Viewed</i>. Deja notas en las líneas y cópialas en su chat de una vez. En la siguiente ronda ves solo lo que cambió desde entonces.', 'Review'],
      ['Revisa el pull request', 'Cuando un agente abre un pull request, revísalo en Adar: los archivos con marcas de <i>Viewed</i>, los lockfiles plegados, los hilos de comentarios en sus líneas. Comenta, sugiere un cambio, pide cambios, y el agente lo lee en GitHub, GitLab, Bitbucket o Azure DevOps. ¿Segunda ronda? <i>Since your review</i> muestra solo lo que se subió después.', 'Since your review'],
      ['Sabe cuándo mirar', '<i>Reviews</i> reúne los pull requests que esperan tu revisión, los que sigues y los tuyos, de todos tus repositorios abiertos. Un punto azul marca lo que ha cambiado desde que miraste, y un aviso te lo dice mientras haces otra cosa.', 'Reviews ⇧⌘R'],
      ['Mergea, recoge, deshaz', 'Mergea desde Adar y la rama y su worktree se van en un paso. Si un agente hizo un reset o un force push que no debía, Adar encuentra los commits perdidos en el reflog, y Undo deshace la última acción de git.', 'Recover Lost Commits…'],
    ],
  },
  inbox: {
    alt: 'La bandeja de pull requests de Adar: uno esperando revisión, uno seguido con una respuesta y un commit nuevo, y dos propios, uno aprobado y listo para mergear.',
    bar: 'Pull requests — todos los repositorios abiertos',
    caption: 'Todo lo que te espera, en un solo sitio. El punto azul es lo que ha cambiado desde que miraste.',
  },
  yours: {
    title: 'Los agentes hacen el trabajo. <span class="serif">Las llaves son tuyas.</span>',
    text: 'Adar usa el git que ya tienes, con las credenciales que ya usas. No tiene cuenta, ni servidores, ni telemetría, y solo habla con GitHub, GitLab, Bitbucket o Azure DevOps cuando activas los pull requests.',
    ticks: ['Tu git y tus claves SSH', 'GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps', 'Cualquier herramienta de agentes: nada que instalar en ellas', 'Gratis y de código abierto · MIT'],
  },
  next: {
    eyebrow: 'Lo próximo',
    tag: 'próximo',
    title: 'Lo que viene, <span class="serif">en abierto.</span>',
    items: [
      ['Vista de equipo', 'Un grupo de pestañas de un vistazo: la rama y los cambios de cada repositorio, las ramas de tus compañeros por autor, los pull requests abiertos y lo que llegó a main desde ayer.'],
      ['Commits escritos por IA en el grafo', 'Una marca en cada commit que escribió un agente, con un filtro humano / IA.'],
      ['Después de un force push', 'La versión vieja y la nueva de una rama que un agente reescribió, lado a lado, y lo que cambió la resolución de conflictos de un merge.'],
      ['Diffs para cambios grandes', 'Un árbol de archivos con las líneas añadidas y quitadas, los archivos generados plegados, los cambios de espacios ocultos cuando quieras, y el teclado para recorrerlo todo.'],
    ],
    link: 'Ver la hoja de ruta',
  },
  cta: {
    title: 'Pruébalo con <span class="serif">tus agentes.</span>',
    text: 'Gratis, de código abierto y con el git que ya tienes.',
    download: 'Descargar Adar',
    github: 'Estrella en GitHub',
  },
};

const eu: AgentsCopy = {
  meta: {
    title: 'Adar AA agenteekin: berrikusi igotzen dutena',
    description: 'Nola lan egin programatzen duten AA agenteekin eta Adarrekin: worktree bat agente bakoitzeko, bakoitza une honetan zertan ari den, begiratu zenuenetik aldatu dena bakarrik berrikusteko aukera eta abisu bat aldaketak igotzen dituztenean edo gelditzen direnean.',
    ogTitle: 'Zure agenteek kodea idazten dute. Zuk agintzen duzu.',
    ogDescription: 'Adar da zure AA agenteek egin dutena ikusteko, berrikusteko eta lanean jarraitzen duten bitartean egunean egoteko tokia.',
  },
  hero: {
    eyebrow: 'Adar + AA agenteak',
    title: 'Zure agenteek kodea idazten dute. <span class="serif">Zuk agintzen duzu.</span>',
    lede: 'Claudek, Copilotek, Codexek edo Cursorrek aldaketa baten ia guztia idazten dute dagoeneko. Ondo dagoen erabakitzea zure lana da oraindik. Adar da egin dutena ikusteko, berrikusteko eta lanean jarraitzen duten bitartean egunean egoteko tokia.',
    download: 'Deskargatu Adar',
    howItWorks: 'Nola dabilen',
  },
  shot: {
    alt: 'Adar Claudekin idatzitako pull request bat berrikusten: azken berrikuspenetik igotako bi commitak bakarrik, egileak erantzundako iruzkin-hari bat eta berrikuspen-panela eskuinean.',
    bar: 'booking-web — #42 zure berrikuspenetik',
    notes: ['<b>Since your review</b>: commit berriak bakarrik', '<b>Claudekin</b> idatzia', '<b>Hariak</b> beren lerroetan', '<b>Zure berrikuspena</b>, behin bakarrik bidalia'],
  },
  steps: {
    eyebrow: 'Zikloa',
    title: 'Sei urrats, <span class="serif">egunero.</span>',
    text: 'Ziklo bera, agente batek akats bat konpontzen duenean zein hiruk funtzio bana eraikitzen dutenean.',
    items: [
      ['Agente bat, worktree bat', 'Eman agente bakoitzari bere karpeta eta bere adarra, bat ere ez dadin bestearen fitxategien gainean ibili. Sortu Adarren edo utzi zure agente-tresnari egiten: bakoitza fitxa gisa irekitzen da proiektuaren taldean, bata bestearen ondoan.', 'New Worktree…'],
      ['Ikusi lanean', 'Worktree bakoitzak bere agentea zertan ari den esaten du: <i>working</i>, <i>quiet</i> —lana amaitu gabe gelditu da eta zure zain egon daiteke— edo geldirik, orain aldatzen ari diren fitxategiekin, bere fitxan, ezkerreko panelean eta <i>Agents</i> ikuspegian. Abisu batek esaten dizu batek commit egiten duenean, aldaketak igotzen dituenean edo geldirik geratzen denean, eta agente batek idatzitako commitek haren izena daramate, beren <code>Co-Authored-By</code> lerrotik.', 'Agents ⇧⌘E'],
      ['Berrikusi pull requestaren aurretik', 'Agente bat gelditzen denean, bere txarteleko <i>Review</i> aukerak mainen aldean egin duen guztia erakusten du: bere commitak eta oraindik commit egin ez duena, <i>Viewed</i> markekin. Utzi oharrak lerroetan eta kopiatu bere txatera behin batean. Hurrengo txandan, ordutik aldatu dena bakarrik ikusten duzu.', 'Review'],
      ['Berrikusi pull requesta', 'Agente batek pull request bat irekitzen duenean, berrikusi Adarren: fitxategiak <i>Viewed</i> markekin, lockfileak tolestuta, iruzkin-hariak beren lerroetan. Iruzkindu, iradoki aldaketa bat, eskatu aldaketak, eta agenteak GitHub, GitLab, Bitbucket edo Azure DevOpsen irakurtzen du. Bigarren txanda? <i>Since your review</i> aukerak ondoren igotakoa bakarrik erakusten du.', 'Since your review'],
      ['Jakin noiz begiratu', '<i>Reviews</i> aukerak zure berrikuspenaren zain dauden pull requestak, jarraitzen dituzunak eta zureak biltzen ditu, irekita dituzun biltegi guztietakoak. Puntu urdin batek begiratu zenuenetik aldatu dena markatzen du, eta jakinarazpen batek beste zerbaitetan zabiltzanean esaten dizu.', 'Reviews ⇧⌘R'],
      ['Mergeatu, jaso, desegin', 'Mergeatu Adarretik eta adarra eta haren worktreea urrats bakarrean doaz. Agente batek behar ez zuen reset edo force push bat egin badu, Adarrek galdutako commitak reflogean aurkitzen ditu, eta Undo-k azken git ekintza desegiten du.', 'Recover Lost Commits…'],
    ],
  },
  inbox: {
    alt: 'Adarren pull requesten sarrera-ontzia: bat berrikuspenaren zain, bat jarraitua erantzun eta commit berri batekin, eta erabiltzailearen bi, bat onartua eta mergeatzeko prest.',
    bar: 'Pull requestak — irekitako biltegi guztiak',
    caption: 'Zure zain dagoen guztia, toki bakarrean. Puntu urdina begiratu zenuenetik aldatu dena da.',
  },
  yours: {
    title: 'Agenteek egiten dute lana. <span class="serif">Giltzak zureak dira.</span>',
    text: 'Adarrek dagoeneko duzun git-a erabiltzen du, dagoeneko erabiltzen dituzun kredentzialekin. Ez du konturik, ez zerbitzaririk, ez telemetriarik, eta pull requestak aktibatzen dituzunean bakarrik hitz egiten du GitHub, GitLab, Bitbucket edo Azure DevOpsekin.',
    ticks: ['Zure git-a eta SSH gakoak', 'GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps', 'Edozein agente-tresna: ezer instalatu gabe haietan', 'Doakoa eta kode irekikoa · MIT'],
  },
  next: {
    eyebrow: 'Hurrengoa',
    tag: 'hurrengoa',
    title: 'Datorrena, <span class="serif">agerian.</span>',
    items: [
      ['Taldearen ikuspegia', 'Fitxa-talde bat begirada batean: errepositorio bakoitzaren adarra eta aldaketak, lankideen adarrak egilearen arabera, pull request irekiak eta atzotik mainera iritsi dena.'],
      ['AAk idatzitako commitak grafoan', 'Marka bat agente batek idatzitako commit bakoitzean, gizaki / AA iragazki batekin.'],
      ['Force push baten ondoren', 'Agente batek berridatzitako adar baten bertsio zaharra eta berria, alboz albo, eta merge baten gatazken konponketak zer aldatu zuen.'],
      ['Aldaketa handien diffak', 'Fitxategi-zuhaitz bat gehitutako eta kendutako lerroekin, sortutako fitxategiak tolestuta, zuriune-aldaketak nahi duzunean ezkutatuta, eta teklatua dena zeharkatzeko.'],
    ],
    link: 'Ikusi bide-orria',
  },
  cta: {
    title: 'Probatu <span class="serif">zure agenteekin.</span>',
    text: 'Doakoa, kode irekikoa eta dagoeneko duzun git-arekin.',
    download: 'Deskargatu Adar',
    github: 'Eman izarra GitHub-en',
  },
};

export const agents: Record<Locale, AgentsCopy> = { en, es, eu };

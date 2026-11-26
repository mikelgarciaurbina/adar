// "Adar + AI agents" page copy in English, Spanish and Basque: how Adar fits working with coding agents, step by
// step, with only what Adar already does. Strings may contain trusted inline HTML (set:html). The app's own words
// (menus, buttons) stay English, as its interface is.
import type { Locale } from './config';

const en = {
  meta: {
    title: 'Review AI coding agents in Git worktrees | Adar',
    description: 'Give each coding agent a Git worktree. Review uncommitted changes, leave line comments and see what changed since your last review in Adar.',
    ogTitle: 'Your agents write the code. You stay in the loop.',
    ogDescription: 'Adar is where you see what your AI agents did, review it, and keep up while they keep going.',
  },
  hero: {
    eyebrow: 'Adar + AI agents',
    title: 'Review the code <span class="serif">your agents write.</span>',
    lede: 'Give Claude, Copilot, Codex or Cursor a worktree of its own. Adar shows which files changed, lets you leave feedback before a pull request and shows what the agent changed in the next round.',
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
    title: 'From worktree <span class="serif">to merge.</span>',
    text: 'The same loop whether one agent is fixing a bug or three are building a feature each.',
    items: [
      ['One agent, one worktree', 'Give each agent its own folder and branch, so none steps on another’s files. Make them in Adar or let your agent tool do it: each opens as a tab in the project’s group, side by side.', 'New Worktree…'],
      ['Run them inside Adar', 'Switch a project’s tab to <i>Terminal</i> and start Claude Code or Codex there, in as many panes as you need. A dot on the tab says whether the agent is working, needs you or has finished, and a notification tells you when it does, or when it commits or pushes. When it writes a plan in Markdown, ⌘-click its path to read it as it will look, while it is still being written.', 'Terminal ⌘E'],
      ['Review before the pull request', 'Choose <i>Review its work</i> on the worktree to compare it with the base branch, including uncommitted changes. Leave notes on individual lines and copy them into the agent’s chat. Next time you can review just the changes made since.', 'Review'],
      ['Review the pull request', 'Open the pull request in Adar to see each file’s diff and comment threads. Mark files as viewed and send your review to the hosting service. Use <i>Since your review</i> to see what changed after your feedback.', 'Since your review'],
      ['Know when to look', '<i>Reviews</i> lists the pull requests waiting for you, the ones you follow and yours, across every open repository. A blue dot marks what changed since you looked, and a notification tells you while you’re doing something else.', 'Reviews ⇧⌘R'],
      ['Merge, tidy up, take back', 'Once the pull request is merged, you can remove its branch and worktree together. If an agent reset or force-pushed what it shouldn’t have, Adar finds the lost commits in the reflog, and Undo takes back the last git action.', 'Recover Lost Commits…'],
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
    github: 'View on GitHub',
  },
};

type AgentsCopy = typeof en;

const es: AgentsCopy = {
  meta: {
    title: 'Revisa el código de tus agentes de IA con Git | Adar',
    description: 'Asigna un worktree de Git a cada agente. Revisa cambios antes del commit, comenta líneas y compara lo que ha cambiado desde tu última revisión en Adar.',
    ogTitle: 'Tus agentes escriben el código. Tú sigues al mando.',
    ogDescription: 'Adar es donde ves lo que han hecho tus agentes de IA, lo revisas y te mantienes al día mientras siguen trabajando.',
  },
  hero: {
    eyebrow: 'Adar + agentes de IA',
    title: 'Revisa el código <span class="serif">de tus agentes de IA.</span>',
    lede: 'Dale a Claude, Copilot, Codex o Cursor su propia carpeta de trabajo en Git. En Adar puedes ver qué archivos ha tocado, dejar comentarios antes de abrir un pull request y revisar qué ha cambiado en la siguiente ronda.',
    download: 'Descargar Adar',
    howItWorks: 'Cómo funciona',
  },
  shot: {
    alt: 'Adar revisando un pull request escrito con Claude: solo los dos commits subidos desde la última revisión, un hilo de comentarios respondido por la autora y el panel de revisión a la derecha.',
    bar: 'booking-web — #42 desde tu revisión',
    notes: ['<b lang="en">Since your review</b>: solo los commits nuevos', 'Escrito con <b>Claude</b>', '<b>Hilos</b> en sus líneas', '<b>Tu revisión</b>, enviada de una vez'],
  },
  steps: {
    eyebrow: 'El ciclo',
    title: 'Del worktree <span class="serif">a la fusión de la rama.</span>',
    text: 'El mismo ciclo, tanto si un agente arregla un fallo como si tres construyen una función cada uno.',
    items: [
      ['Un agente, un worktree', 'Dale a cada agente su propia carpeta y su rama, para que ninguno pise los archivos de otro. Créalos en Adar o deja que lo haga tu herramienta de agentes: cada uno se abre como una pestaña en el grupo del proyecto, uno al lado del otro.', 'New Worktree…'],
      ['Ejecútalos dentro de Adar', 'Cambia la pestaña del proyecto a <i lang="en">Terminal</i> y lanza ahí Claude Code o Codex, en tantos paneles como necesites. Un punto en la pestaña indica si el agente está trabajando, te necesita o ha terminado, y recibes un aviso cuando ocurre, o cuando crea un commit o sube cambios. Si escribe un plan en Markdown, haz ⌘-clic en su ruta para leerlo con formato mientras lo sigue escribiendo.', 'Terminal ⌘E'],
      ['Revisa antes de abrir un pull request', 'Selecciona <i lang="en">Review its work</i> en el worktree para comparar su trabajo con la rama base, incluidos los cambios pendientes de commit. Deja notas por línea y cópialas juntas en su chat. En la siguiente revisión puedes centrarte en lo que ha cambiado desde entonces.', 'Review'],
      ['Revisa el pull request', 'Abre el pull request en Adar para ver las diferencias y los hilos de comentarios de cada archivo. Marca los archivos revisados y envía tu revisión al servicio que aloja el repositorio. Con <i lang="en">Since your review</i> puedes ver qué cambió después.', 'Since your review'],
      ['Qué revisiones tienes pendientes', '<i>Reviews</i> reúne los pull requests que esperan tu revisión, los que sigues y los tuyos, de todos tus repositorios abiertos. Un punto azul marca lo que ha cambiado desde que miraste, y un aviso te lo dice mientras haces otra cosa.', 'Reviews ⇧⌘R'],
      ['Fusiona la rama y limpia el worktree', 'Después de fusionar el pull request, puedes eliminar la rama y su worktree en un solo paso. Si un agente hizo un reset o un force push que no debía, Adar encuentra los commits perdidos en el reflog, y Undo deshace la última acción de git.', 'Recover Lost Commits…'],
    ],
  },
  inbox: {
    alt: 'La bandeja de pull requests de Adar: uno esperando revisión, uno seguido con una respuesta y un commit nuevo, y dos propios, uno aprobado y listo para integrar.',
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
    github: 'Ver en GitHub',
  },
};

const eu: AgentsCopy = {
  meta: {
    title: 'Berrikusi AAko agenteen kodea Git worktreeetan | Adar',
    description: 'Eman Git worktree bana agenteei. Berrikusi aldaketak commita egin aurretik, utzi oharrak lerroetan eta ikusi azken berrikuspenetik zer aldatu den.',
    ogTitle: 'Zure agenteek kodea idazten dute. Zuk agintzen duzu.',
    ogDescription: 'Adar da zure AA agenteek egin dutena ikusteko, berrikusteko eta lanean jarraitzen duten bitartean egunean egoteko tokia.',
  },
  hero: {
    eyebrow: 'Adar + AA agenteak',
    title: 'Berrikusi <span class="serif">AAko agenteen kodea.</span>',
    lede: 'Eman Git lan-karpeta bana Claude, Copilot, Codex edo Cursorri. Adarren ikus dezakezu zein fitxategi aldatu dituzten, oharrak utzi pull requesta ireki aurretik eta hurrengo txandako aldaketak berrikusi.',
    download: 'Deskargatu Adar',
    howItWorks: 'Nola dabilen',
  },
  shot: {
    alt: 'Adar Claudekin idatzitako pull request bat berrikusten: azken berrikuspenetik igotako bi commitak bakarrik, egileak erantzundako iruzkin-hari bat eta berrikuspen-panela eskuinean.',
    bar: 'booking-web — #42 zure berrikuspenetik',
    notes: ['<b lang="en">Since your review</b>: commit berriak bakarrik', '<b>Claudekin</b> idatzia', '<b>Hariak</b> beren lerroetan', '<b>Zure berrikuspena</b>, behin bakarrik bidalia'],
  },
  steps: {
    eyebrow: 'Zikloa',
    title: 'Lan-karpeta sortzetik <span class="serif">adarra bateratu arte.</span>',
    text: 'Ziklo bera, agente batek akats bat konpontzen duenean zein hiruk funtzio bana eraikitzen dutenean.',
    items: [
      ['Agente bat, worktree bat', 'Eman agente bakoitzari bere karpeta eta bere adarra, bat ere ez dadin bestearen fitxategien gainean ibili. Sortu Adarren edo utzi zure agente-tresnari egiten: bakoitza fitxa gisa irekitzen da proiektuaren taldean, bata bestearen ondoan.', 'New Worktree…'],
      ['Exekutatu Adar barruan', 'Aldatu proiektuaren fitxa <i lang="en">Terminal</i> ikuspegira eta abiarazi han Claude Code edo Codex, behar adina paneletan. Fitxako puntu batek adierazten du agentea lanean ari den, zure beharra duen edo amaitu duen, eta abisu bat jasoko duzu hori gertatzean, edo commita egiten duenean edo aldaketak igotzen dituenean. Plan bat Markdownen idazten badu, egin ⌘-klik fitxategiaren bidean, formatuarekin irakurtzeko idazten ari den bitartean.', 'Terminal ⌘E'],
      ['Berrikusi pull requesta ireki aurretik', 'Aukeratu <i lang="en">Review its work</i> worktreean haren lana oinarri-adarrarekin alderatzeko. Oraindik commitean sartu gabeko aldaketak ere ikusiko dituzu. Idatzi oharrak lerroetan eta kopiatu denak agentearen txatera. Hurrengoan, ordutik egindako aldaketak soilik berrikus ditzakezu.', 'Review'],
      ['Berrikusi pull requesta', 'Ireki pull requesta Adarren fitxategi bakoitzeko aldaketak eta iruzkin-hariak ikusteko. Markatu berrikusitako fitxategiak eta bidali berrikuspena biltegia ostatatzen duen zerbitzura. <i lang="en">Since your review</i> aukerarekin ordutik zer aldatu den ikusi dezakezu.', 'Since your review'],
      ['Jakin noiz begiratu', '<i>Reviews</i> aukerak zure berrikuspenaren zain dauden pull requestak, jarraitzen dituzunak eta zureak biltzen ditu, irekita dituzun biltegi guztietakoak. Puntu urdin batek begiratu zenuenetik aldatu dena markatzen du, eta jakinarazpen batek beste zerbaitetan zabiltzanean esaten dizu.', 'Reviews ⇧⌘R'],
      ['Bateratu adarra eta garbitu lan-karpeta', 'Pull requesta bateratu ondoren, adarra eta haren lan-karpeta batera ezaba ditzakezu. Agente batek behar ez zuen reset edo force push bat egin badu, Adarrek galdutako commitak reflogean aurkitzen ditu, eta Undo-k azken git ekintza desegiten du.', 'Recover Lost Commits…'],
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
    github: 'Ikusi GitHuben',
  },
};

export const agents: Record<Locale, AgentsCopy> = { en, es, eu };

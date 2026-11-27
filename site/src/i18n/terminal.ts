// "Claude Code and Codex inside Adar" page copy in English, Spanish and Basque: how to run those agents in Adar's
// terminal, step by step, and the editor for the small fix, with only what Adar already does. Strings may contain
// trusted inline HTML (set:html). The app's own words (menus, buttons, shortcuts) stay English, as its interface is.
import type { Locale } from './config';

const en = {
  meta: {
    title: 'Run Claude Code and Codex inside a Git client | Adar',
    description: 'Start Claude Code or Codex in a terminal inside Adar. See when an agent needs you, read what it wrote and fix the small things without leaving your Git client.',
    ogTitle: 'Claude Code and Codex, inside your Git client.',
    ogDescription: 'A terminal in every project, a dot that says when an agent needs you, and an editor for the line you would rather fix yourself.',
  },
  hero: {
    eyebrow: 'Adar + Claude Code & Codex',
    title: 'Claude Code and Codex, <span class="serif">inside your Git client.</span>',
    lede: 'Adar has a terminal in every project’s tab. Start your agent there and keep the commit graph, its changes and its pull request in the same window: you see when it needs you, read what it wrote and fix the small things yourself.',
    download: 'Download Adar',
    howItWorks: 'How it works',
  },
  shot: {
    alt: 'Adar with a demo repository: the commit graph above and, below, two terminals side by side. One runs Claude Code, which is waiting for an answer, beside a shell; a second tab runs Codex, which is working.',
    bar: 'booking-web — graph and terminal',
    notes: ['<b>Graph, changes and terminal</b> in one tab', '<b>A dot</b> says what each agent is doing', '<b>Side by side</b>: the agent and your shell', '<b>Needs you</b>, in the status bar too'],
  },
  steps: {
    eyebrow: 'How it works',
    title: 'From a prompt <span class="serif">to a commit.</span>',
    text: 'The same window from the first prompt to the last commit, whether one agent is running or several.',
    items: [
      ['Start it where the code is', 'Switch a project’s tab to <i>Terminal</i>, or to <i>Both</i> to keep the graph above it, and choose what to start: your shell, Claude Code or Codex. It runs in your own login shell, in the repository’s folder, with the accounts you are already signed in to.', 'Terminal ⌘E'],
      ['Know when it needs you', 'A dot on the tab says what the agent is doing: working, waiting for your answer, or finished. A notification tells you when it stops to ask or is done, and a click on it takes you to that terminal. Claude Code and an up-to-date Codex report all three.', 'Needs you'],
      ['Run as many as you need', 'Split a terminal into panes or open more tabs: one agent building, another testing, your own shell beside them. Give each agent a worktree of its own and each gets its tab, side by side in the project’s group.', 'Split Right ⌘D'],
      ['Hand it a screenshot', 'Drop a picture or any file on a terminal and its path is typed there for the agent to read. Adar uploads nothing: it is the file on your disk.', 'Drag & drop'],
      ['Read what it wrote', '⌘-click a path the agent printed. A plan in Markdown opens as it will look and follows the file while it is being written, a picture shows over its link, and a file of code opens at the line it names.', '⌘-click'],
      ['Fix the small thing yourself', 'A wrong word, a <code>.env</code> the agent will not touch, one line not worth another prompt: the file opens in Adar’s own editor. Save, and it is among your changes, ready to commit.', 'Files ⇧⌘E'],
    ],
  },
  editor: {
    eyebrow: 'The editor',
    title: 'An editor for the small fix, <span class="serif">and nothing more.</span>',
    text: 'Your agent writes the code, and your IDE is still there for the long sessions. Adar’s editor is for the two minutes in between: the line you would rather change than explain.',
    alt: 'Adar after a ⌘-click on a path in the terminal: the file is open at the line the agent changed, with the repository’s files on the left, the changes on the right and the terminals below.',
    bar: 'booking-web — src/lib/rates.ts',
    caption: 'A ⌘-click on <code>src/lib/rates.ts:9</code> in the terminal opens the file at that line.',
    items: [
      ['Simple on purpose', 'Syntax colours, find and replace, several cursors and undo. No autocomplete, no language server, no extensions: nothing to set up, and nothing to keep up to date.'],
      ['It knows an agent is writing too', 'If the file changes on disk while it is open, the text follows it. If you had changes of your own, Adar tells you before anything is written over.'],
      ['Every file of the repository', 'The tree lists what Git ignores as well, so the <code>.env</code> your agent will not open is one click away. Find any file by name with ⌘P.'],
      ['Edit, save, commit', 'The changes panel stays beside the file: what you save shows there at once, ready to stage and commit without leaving the view.'],
    ],
  },
  review: {
    title: 'Then review it <span class="serif">like any other change.</span>',
    text: 'What an agent wrote is still a branch. Compare its worktree with the base branch before there is a pull request, leave notes on its lines, and next time see only what it changed since.',
    link: 'Reviewing an agent’s work',
    ticks: ['A worktree and a tab for each agent', 'Its work reviewed before the pull request', 'Only what changed since your last review', 'A notification when it commits or pushes'],
  },
  cta: {
    title: 'Try it with <span class="serif">Claude Code or Codex.</span>',
    text: 'Free, open source, and in your own shell.',
    download: 'Download Adar',
    github: 'View on GitHub',
  },
  legal: 'Claude Code is a product of Anthropic and Codex a product of OpenAI. Adar is an independent open-source project, not affiliated with either.',
};

const es: typeof en = {
  meta: {
    title: 'Claude Code y Codex dentro de tu cliente Git | Adar',
    description: 'Lanza Claude Code o Codex en una terminal dentro de Adar. Sabe cuándo te necesita un agente, lee lo que ha escrito y arregla lo pequeño sin salir de tu cliente Git.',
    ogTitle: 'Claude Code y Codex, dentro de tu cliente Git.',
    ogDescription: 'Una terminal en cada proyecto, un punto que avisa cuando un agente te necesita y un editor para la línea que prefieres arreglar tú.',
  },
  hero: {
    eyebrow: 'Adar + Claude Code y Codex',
    title: 'Claude Code y Codex, <span class="serif">dentro de tu cliente Git.</span>',
    lede: 'Adar tiene una terminal en la pestaña de cada proyecto. Lanza ahí tu agente y ten el grafo de commits, sus cambios y su pull request en la misma ventana: ves cuándo te necesita, lees lo que ha escrito y arreglas tú lo pequeño.',
    download: 'Descargar Adar',
    howItWorks: 'Cómo funciona',
  },
  shot: {
    alt: 'Adar con un repositorio de ejemplo: arriba el grafo de commits y, debajo, dos terminales en paralelo. En una está Claude Code, que espera una respuesta, junto a una shell; en otra pestaña trabaja Codex.',
    bar: 'booking-web — grafo y terminal',
    notes: ['<b>Grafo, cambios y terminal</b> en una pestaña', '<b>Un punto</b> dice qué hace cada agente', '<b>En paralelo</b>: el agente y tu shell', '<b>Te necesita</b>: también en la barra de estado'],
  },
  steps: {
    eyebrow: 'Cómo funciona',
    title: 'Del prompt <span class="serif">al commit.</span>',
    text: 'La misma ventana desde el primer prompt hasta el último commit, con un agente o con varios.',
    items: [
      ['Lánzalo donde está el código', 'Cambia la pestaña del proyecto a <i lang="en">Terminal</i>, o a <i lang="en">Both</i> para dejar el grafo encima, y elige qué lanzar: tu shell, Claude Code o Codex. Se ejecuta en tu propia shell de inicio de sesión, en la carpeta del repositorio y con las cuentas en las que ya has iniciado sesión.', 'Terminal ⌘E'],
      ['Sabe cuándo te necesita', 'Un punto en la pestaña dice qué hace el agente: trabajando, esperando tu respuesta o terminado. Una notificación te avisa cuando se para a preguntar o cuando acaba, y al hacer clic en ella vas a esa terminal. Claude Code y un Codex actualizado informan de los tres estados.', 'Needs you'],
      ['Lanza los que necesites', 'Divide una terminal en paneles o abre más pestañas: un agente construyendo, otro probando y tu shell al lado. Dale a cada agente su propio worktree y cada uno tendrá su pestaña, una junto a otra en el grupo del proyecto.', 'Split Right ⌘D'],
      ['Pásale una captura', 'Suelta una imagen o cualquier archivo sobre una terminal y se escribe su ruta para que el agente lo lea. Adar no sube nada: es el archivo de tu disco.', 'Drag & drop'],
      ['Lee lo que ha escrito', 'Haz ⌘-clic sobre una ruta que haya impreso el agente. Un plan en Markdown se abre con formato y sigue al archivo mientras se escribe, una imagen se muestra sobre su enlace y un archivo de código se abre en la línea que indica.', '⌘-click'],
      ['Arregla tú lo pequeño', 'Una palabra mal puesta, un <code>.env</code> que el agente no quiere tocar, una línea que no merece otro prompt: el archivo se abre en el editor de Adar. Guarda y ya está entre tus cambios, listo para el commit.', 'Files ⇧⌘E'],
    ],
  },
  editor: {
    eyebrow: 'El editor',
    title: 'Un editor para el arreglo pequeño, <span class="serif">y nada más.</span>',
    text: 'Tu agente escribe el código y tu IDE sigue ahí para las sesiones largas. El editor de Adar es para los dos minutos de en medio: la línea que prefieres cambiar antes que explicar.',
    alt: 'Adar tras un ⌘-clic sobre una ruta en la terminal: el archivo abierto en la línea que cambió el agente, con los archivos del repositorio a la izquierda, los cambios a la derecha y las terminales debajo.',
    bar: 'booking-web — src/lib/rates.ts',
    caption: 'Un ⌘-clic sobre <code>src/lib/rates.ts:9</code> en la terminal abre el archivo en esa línea.',
    items: [
      ['Simple a propósito', 'Colores de sintaxis, buscar y reemplazar, varios cursores y deshacer. Sin autocompletado, sin servidor de lenguaje y sin extensiones: nada que configurar ni que mantener al día.'],
      ['Sabe que el agente también escribe', 'Si el archivo cambia en disco mientras lo tienes abierto, el texto lo sigue. Si tenías cambios tuyos, Adar te avisa antes de sobrescribir nada.'],
      ['Todos los archivos del repositorio', 'El árbol muestra también lo que Git ignora, así que el <code>.env</code> que tu agente no quiere abrir está a un clic. Encuentra cualquier archivo por su nombre con ⌘P.'],
      ['Edita, guarda y haz commit', 'El panel de cambios sigue junto al archivo: lo que guardas aparece ahí al momento, listo para el stage y el commit sin salir de la vista.'],
    ],
  },
  review: {
    title: 'Y después revísalo <span class="serif">como cualquier otro cambio.</span>',
    text: 'Lo que escribe un agente sigue siendo una rama. Compara su worktree con la rama base antes de que haya pull request, deja notas en sus líneas y, la próxima vez, mira solo lo que ha cambiado desde entonces.',
    link: 'Cómo revisar el trabajo de un agente',
    ticks: ['Un worktree y una pestaña por agente', 'Su trabajo revisado antes del pull request', 'Solo lo que ha cambiado desde tu última revisión', 'Un aviso cuando crea un commit o sube cambios'],
  },
  cta: {
    title: 'Pruébalo con <span class="serif">Claude Code o Codex.</span>',
    text: 'Gratis, de código abierto y en tu propia shell.',
    download: 'Descargar Adar',
    github: 'Ver en GitHub',
  },
  legal: 'Claude Code es un producto de Anthropic y Codex, de OpenAI. Adar es un proyecto independiente de código abierto, sin relación con ninguno de los dos.',
};

const eu: typeof en = {
  meta: {
    title: 'Claude Code eta Codex zure Git bezeroaren barruan | Adar',
    description: 'Abiarazi Claude Code edo Codex Adarren barruko terminal batean. Jakin agente batek zure beharra noiz duen, irakurri idatzi duena eta konpondu txikikeriak Git bezerotik irten gabe.',
    ogTitle: 'Claude Code eta Codex, zure Git bezeroaren barruan.',
    ogDescription: 'Terminal bat proiektu bakoitzean, agente batek zure beharra duenean abisatzen duen puntu bat, eta editore bat zuk zeuk konpondu nahiago duzun lerrorako.',
  },
  hero: {
    eyebrow: 'Adar + Claude Code eta Codex',
    title: 'Claude Code eta Codex, <span class="serif">zure Git bezeroaren barruan.</span>',
    lede: 'Adarrek terminal bat du proiektu bakoitzaren fitxan. Abiarazi han zure agentea eta izan commit grafoa, haren aldaketak eta haren pull requesta leiho berean: noiz behar zaituen ikusiko duzu, idatzi duena irakurriko duzu eta txikikeriak zuk zeuk konponduko dituzu.',
    download: 'Deskargatu Adar',
    howItWorks: 'Nola dabilen',
  },
  shot: {
    alt: 'Adar adibide-biltegi batekin: goian commit grafoa eta, behean, bi terminal alboz albo. Batean Claude Code dago, erantzun baten zain, shell baten ondoan; beste fitxa batean Codex lanean ari da.',
    bar: 'booking-web — grafoa eta terminala',
    notes: ['<b>Grafoa, aldaketak eta terminala</b> fitxa berean', '<b>Puntu batek</b> esaten du agente bakoitza zertan ari den', '<b>Alboz albo</b>: agentea eta zure shella', '<b>Zure beharra du</b>: egoera-barran ere bai'],
  },
  steps: {
    eyebrow: 'Nola dabilen',
    title: 'Promptetik <span class="serif">commitera.</span>',
    text: 'Leiho bera lehen promptetik azken commitera, agente bakarrarekin edo hainbatekin.',
    items: [
      ['Abiarazi kodea dagoen tokian', 'Aldatu proiektuaren fitxa <i lang="en">Terminal</i> ikuspegira, edo <i lang="en">Both</i> ikuspegira grafoa gainean uzteko, eta aukeratu zer abiarazi: zure shella, Claude Code edo Codex. Zure saio-hasierako shellean exekutatzen da, biltegiaren karpetan eta dagoeneko saioa hasita duzun kontuekin.', 'Terminal ⌘E'],
      ['Jakin noiz behar zaituen', 'Fitxako puntu batek esaten du agentea zertan ari den: lanean, zure erantzunaren zain edo amaituta. Jakinarazpen batek abisatzen dizu galdetzeko gelditzen denean edo amaitzen duenean, eta haren gainean klik eginda terminal horretara joango zara. Claude Codek eta Codex eguneratu batek hiru egoerak jakinarazten dituzte.', 'Needs you'],
      ['Abiarazi behar adina', 'Zatitu terminal bat paneletan edo ireki fitxa gehiago: agente bat eraikitzen, beste bat probatzen eta zure shella ondoan. Eman agente bakoitzari bere worktreea eta bakoitzak bere fitxa izango du, bata bestearen ondoan proiektuaren taldean.', 'Split Right ⌘D'],
      ['Eman pantaila-argazki bat', 'Jaregin irudi bat edo edozein fitxategi terminal baten gainean eta haren bidea idatziko da, agenteak irakur dezan. Adarrek ez du ezer igotzen: zure diskoko fitxategia da.', 'Drag & drop'],
      ['Irakurri idatzi duena', 'Egin ⌘-klik agenteak idatzitako bide batean. Markdown plan bat formatuarekin irekiko da eta fitxategiari jarraituko dio idazten den bitartean, irudi bat bere estekaren gainean erakutsiko da, eta kode-fitxategi bat adierazitako lerroan irekiko da.', '⌘-click'],
      ['Konpondu zuk zeuk txikikeriak', 'Gaizki idatzitako hitz bat, agenteak ukitu nahi ez duen <code>.env</code> bat, beste prompt bat merezi ez duen lerro bat: fitxategia Adarren editorean irekiko da. Gorde, eta zure aldaketen artean izango da, commiterako prest.', 'Files ⇧⌘E'],
    ],
  },
  editor: {
    eyebrow: 'Editorea',
    title: 'Editore bat konponketa txikirako, <span class="serif">eta besterik ez.</span>',
    text: 'Zure agenteak idazten du kodea, eta zure IDEa hor dago oraindik saio luzeetarako. Adarren editorea tarteko bi minutuetarako da: azaldu baino lehenago aldatu nahiago duzun lerro horretarako.',
    alt: 'Adar, terminaleko bide batean ⌘-klik egin ondoren: fitxategia agenteak aldatutako lerroan irekita, biltegiko fitxategiak ezkerrean, aldaketak eskuinean eta terminalak behean.',
    bar: 'booking-web — src/lib/rates.ts',
    caption: 'Terminalean <code>src/lib/rates.ts:9</code> bidean ⌘-klik eginda, fitxategia lerro horretan irekitzen da.',
    items: [
      ['Nahita sinplea', 'Sintaxi-koloreak, bilatu eta ordeztu, hainbat kurtsore eta desegin. Osatze automatikorik gabe, lengoaia-zerbitzaririk gabe eta luzapenik gabe: ez dago ezer konfiguratzeko, ezta eguneratuta mantentzeko ere.'],
      ['Badaki agentea ere idazten ari dela', 'Fitxategia diskoan aldatzen bada irekita duzun bitartean, testuak jarraitu egiten dio. Zure aldaketak bazenituen, Adarrek abisatuko dizu ezer gainidatzi aurretik.'],
      ['Biltegiko fitxategi guztiak', 'Zuhaitzak Gitek baztertzen duena ere erakusten du; beraz, zure agenteak ireki nahi ez duen <code>.env</code> hori klik batera dago. Aurkitu edozein fitxategi izenez, ⌘P-rekin.'],
      ['Editatu, gorde eta egin commit', 'Aldaketen panela fitxategiaren ondoan geratzen da: gordetzen duzuna berehala agertzen da han, stage eta commit egiteko prest, ikuspegitik irten gabe.'],
    ],
  },
  review: {
    title: 'Eta gero berrikusi <span class="serif">beste edozein aldaketa bezala.</span>',
    text: 'Agente batek idazten duena adar bat da oraindik. Alderatu haren worktreea oinarri-adarrarekin pull requesta egon aurretik, utzi oharrak lerroetan eta, hurrengoan, ikusi ordutik aldatu duena bakarrik.',
    link: 'Nola berrikusi agente baten lana',
    ticks: ['Worktree bat eta fitxa bat agente bakoitzeko', 'Haren lana berrikusita pull requesta baino lehen', 'Zure azken berrikuspenetik aldatu dena bakarrik', 'Abisu bat commita egiten duenean edo aldaketak igotzen dituenean'],
  },
  cta: {
    title: 'Probatu <span class="serif">Claude Code edo Codexekin.</span>',
    text: 'Doakoa, kode irekikoa, eta zure shellean.',
    download: 'Deskargatu Adar',
    github: 'Ikusi GitHuben',
  },
  legal: 'Claude Code Anthropicen produktua da, eta Codex OpenAIrena. Adar kode irekiko proiektu independentea da, eta ez du inolako loturarik haiekin.',
};

export const terminal: Record<Locale, typeof en> = { en, es, eu };

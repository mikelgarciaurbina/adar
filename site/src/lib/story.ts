// The landing page's story: one night in the forest. Each chapter pairs a Basque word with a true thing
// about the forest and a part of the product. Used by the landing (chapters, rail) and documented in Basoa.
// The Basque word is the same in every language; ids, labels and descriptions follow the page's language.
import type { Locale } from '../i18n/config';

type L = Record<Locale, string>;
interface Source { n: string; eu: string; id: L; label: L; image: L; product: L }
export interface StoryChapter { id: string; n: string; eu: string; en: string; image: string; product: string }

const SOURCE: Source[] = [
  { n: '0', eu: 'Gaua',
    id: { en: 'night', es: 'noche', eu: 'gaua' },
    label: { en: 'Night', es: 'Noche', eu: 'hasiera' },
    image: { en: 'Antlers grow out of the dark', es: 'La cornamenta crece en la oscuridad', eu: 'Adarrak iluntasunetik hazten dira' },
    product: { en: 'What Adar is, download', es: 'Qué es Adar, descarga', eu: 'Zer den Adar, deskarga' } },
  { n: 'I', eu: 'Adar',
    id: { en: 'name', es: 'nombre', eu: 'izena' },
    label: { en: 'The name', es: 'El nombre', eu: 'izena' },
    image: { en: 'Antler → tree branch → git branch', es: 'Cuerna → rama de árbol → rama de git', eu: 'Oreinaren adarra → zuhaitzaren adarra → git adarra' },
    product: { en: 'Why it is called Adar', es: 'Por qué se llama Adar', eu: 'Zergatik du Adar izena' } },
  { n: 'II', eu: 'Enborra',
    id: { en: 'showcase', es: 'tronco', eu: 'enborra' },
    label: { en: 'The trunk', es: 'El tronco', eu: 'aplikazioa' },
    image: { en: 'Every forest starts with a trunk', es: 'Todo bosque empieza con un tronco', eu: 'Baso guztiak enbor batetik hasten dira' },
    product: { en: 'The app and its commit graph', es: 'La app y su grafo de commits', eu: 'Aplikazioa eta bere commit grafoa' } },
  { n: 'III', eu: 'Adarrak',
    id: { en: 'features', es: 'funciones', eu: 'ezaugarriak' },
    label: { en: 'The branches', es: 'Las ramas', eu: 'ezaugarriak' },
    image: { en: 'Branches split and grow back together', es: 'Las ramas se separan y vuelven a unirse', eu: 'Adarrak bereizi eta berriro elkartzen dira' },
    product: { en: 'Branching, merging, rebasing, staging', es: 'Ramas, merge, rebase, staging', eu: 'Adarrak, merge, rebase, staging' } },
  { n: 'IV', eu: 'Eraztunak',
    id: { en: 'rings', es: 'anillos', eu: 'eraztunak' },
    label: { en: 'The rings', es: 'Los anillos', eu: 'historia' },
    image: { en: 'A tree adds a ring a year and keeps them all', es: 'Un árbol suma un anillo al año y los guarda todos', eu: 'Zuhaitzak eraztun bat gehitzen du urtero eta denak gordetzen ditu' },
    product: { en: 'History, blame, undo; Adar’s releases as rings', es: 'Historial, blame, deshacer; las versiones de Adar como anillos', eu: 'Historia, blame, desegin; Adarren bertsioak eraztun gisa' } },
  { n: 'V', eu: 'Sustraiak',
    id: { en: 'yours', es: 'raices', eu: 'sustraiak' },
    label: { en: 'The roots', es: 'Las raíces', eu: 'zure git-a' },
    image: { en: 'Roots drink from what is already in the ground', es: 'Las raíces beben de lo que ya hay en la tierra', eu: 'Sustraiek lurrean dagoena edaten dute' },
    product: { en: 'Your git, your keys, your terminal', es: 'Tu git, tus claves, tu terminal', eu: 'Zure git-a, zure gakoak, zure terminala' } },
  { n: 'VI', eu: 'Egunsentia',
    id: { en: 'download', es: 'descarga', eu: 'deskarga' },
    label: { en: 'Dawn', es: 'Amanecer', eu: 'deskarga' },
    image: { en: 'Deer shed their antlers and grow a bigger set', es: 'El ciervo muda la cornamenta y le crece otra mayor', eu: 'Oreinak adarrak botatzen ditu eta handiagoak hazten zaizkio' },
    product: { en: 'Releases and download', es: 'Versiones y descarga', eu: 'Bertsioak eta deskarga' } },
  { n: 'VII', eu: 'Auzolana',
    id: { en: 'open-source', es: 'codigo-abierto', eu: 'auzolana' },
    label: { en: 'Built together', es: 'Hecho entre todos', eu: 'kode irekia' },
    image: { en: 'Neighbours working on what belongs to everyone', es: 'Vecinos trabajando en lo que es de todos', eu: 'Auzokideak denona denaren alde lanean' },
    product: { en: 'Open source, roadmap, contributing', es: 'Código abierto, hoja de ruta, contribuir', eu: 'Kode irekia, bide-orria, laguntzea' } },
];

export const chaptersFor = (lang: Locale): StoryChapter[] =>
  SOURCE.map((c) => ({ id: c.id[lang], n: c.n, eu: c.eu, en: c.label[lang], image: c.image[lang], product: c.product[lang] }));

/** A chapter by its position (0 = night … 7 = built together), in a language. */
export const chapter = (index: number, lang: Locale) => chaptersFor(lang)[index];

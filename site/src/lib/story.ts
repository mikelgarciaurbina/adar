// The landing page's story: one night in the forest. Each chapter pairs a Basque word with a true thing
// about the forest and a part of the product. Used by the landing (chapters, rail) and documented in Basoa.
export interface StoryChapter { id: string; n: string; eu: string; en: string; image: string; product: string }

export const chapters: StoryChapter[] = [
  { id: 'night', n: '0', eu: 'Gaua', en: 'Night', image: 'Antlers grow out of the dark', product: 'What Adar is, download' },
  { id: 'name', n: 'I', eu: 'Adar', en: 'The name', image: 'Antler → tree branch → git branch', product: 'Why it is called Adar' },
  { id: 'showcase', n: 'II', eu: 'Enborra', en: 'The trunk', image: 'Every forest starts with a trunk', product: 'The app and its commit graph' },
  { id: 'features', n: 'III', eu: 'Adarrak', en: 'The branches', image: 'Branches split and grow back together', product: 'Branching, merging, rebasing, staging' },
  { id: 'rings', n: 'IV', eu: 'Eraztunak', en: 'The rings', image: 'A tree adds a ring a year and keeps them all', product: 'History, blame, undo; Adar’s releases as rings' },
  { id: 'yours', n: 'V', eu: 'Sustraiak', en: 'The roots', image: 'Roots drink from what is already in the ground', product: 'Your git, your keys, your terminal' },
  { id: 'download', n: 'VI', eu: 'Egunsentia', en: 'Dawn', image: 'Deer shed their antlers and grow a bigger set', product: 'Releases and download' },
  { id: 'open-source', n: 'VII', eu: 'Auzolana', en: 'Built together', image: 'Neighbours working on what belongs to everyone', product: 'Open source, roadmap, contributing' },
];

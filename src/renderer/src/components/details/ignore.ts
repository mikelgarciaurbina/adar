// Derive .gitignore patterns for the "Ignore ▸" context submenu of the
// staging area: this exact file, all files with the same extension, or the
// containing folder.

export interface IgnoreOption {
  label: string
  pattern: string
}

/**
 * Escape a literal path so gitignore treats it verbatim: glob metacharacters,
 * a leading "#" or "!" and trailing spaces get a backslash.
 */
export function escapeGitignore(path: string): string {
  let out = path.replace(/[\\*?[\]]/g, (c) => `\\${c}`)
  if (out.startsWith('#') || out.startsWith('!')) out = `\\${out}`
  out = out.replace(/( +)$/, (spaces) => spaces.replace(/ /g, '\\ '))
  return out
}

/** Extension of a file name ("tar.gz" → "gz"); null for dotfiles or names without one. */
export function fileExtension(name: string): string | null {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return null
  return name.slice(i + 1)
}

/** Ignore choices for a repo-relative path. Paths ending in "/" are directories (untracked folders). */
export function ignoreOptions(path: string): IgnoreOption[] {
  const isDir = path.endsWith('/')
  const clean = path.replace(/\/+$/, '')
  if (!clean) return []
  const slash = clean.lastIndexOf('/')
  const name = slash >= 0 ? clean.slice(slash + 1) : clean
  const dir = slash >= 0 ? clean.slice(0, slash) : ''
  const options: IgnoreOption[] = []

  if (isDir) {
    options.push({ label: `Ignore folder ${clean}/`, pattern: `/${escapeGitignore(clean)}/` })
  } else {
    options.push({ label: `Ignore ${name}`, pattern: `/${escapeGitignore(clean)}` })
    const ext = fileExtension(name)
    if (ext) options.push({ label: `Ignore all *.${ext} files`, pattern: `*.${escapeGitignore(ext)}` })
  }
  if (dir) options.push({ label: `Ignore folder ${dir}/`, pattern: `/${escapeGitignore(dir)}/` })
  return options
}

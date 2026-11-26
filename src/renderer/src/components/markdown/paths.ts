// Where an address written in a document of a repository leads inside it, pure: the diff view reads a document, its
// pictures and the documents it links to from the revision it shows, by their paths in the repository.

/** "docs/guide/../a.md" → "docs/a.md"; null when it climbs out of the repository. */
function normalize(path: string): string | null {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

/**
 * The repository path an address in the document at `doc` (a repository path too) names, with the heading after `#`:
 * beside the document, or from the repository's root when it starts with `/`. Null for the web, any other scheme and
 * anything outside the repository.
 */
export function repoReference(doc: string, ref: string): { path: string; anchor: string } | null {
  let target = ref.trim()
  if (!target || target.includes('\0') || target.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('~')) return null
  let anchor = ''
  const hash = target.indexOf('#')
  if (hash >= 0) {
    anchor = target.slice(hash + 1)
    target = target.slice(0, hash)
  }
  const query = target.indexOf('?')
  if (query >= 0) target = target.slice(0, query)
  try {
    target = decodeURIComponent(target)
    anchor = decodeURIComponent(anchor)
  } catch {
    // Not percent-encoded: read as written.
  }
  if (!target) return { path: doc, anchor }
  const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : ''
  const path = normalize(target.startsWith('/') ? target : `${dir}/${target}`)
  return path ? { path, anchor } : null
}

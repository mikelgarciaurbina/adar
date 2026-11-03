// Authors' pictures from the repository's GitHub, GitLab or Bitbucket (getAuthorAvatars), for avatars Gravatar has
// nothing for. Asked in batches as avatars appear on screen and remembered for the session; an author without one
// is asked about again after a while (pull requests turned on later, a new picture).

import { api } from '@renderer/api/client'

const BATCH = 40
const MISS_MS = 10 * 60_000

const known = new Map<string, { url: string | null; at: number }>()
const waiting = new Map<string, Array<(url: string | null) => void>>()
/** Repository → email → a commit of theirs. */
const queue = new Map<string, Map<string, string>>()
let timer: ReturnType<typeof setTimeout> | null = null

const keyOf = (repo: string, email: string) => `${repo}\n${email}`

/** The provider's picture of `email` (data: URL), or null; `sha` is a commit of theirs the provider may know. */
export function providerAvatar(repo: string, email: string, sha: string): Promise<string | null> {
  const e = email.trim().toLowerCase()
  const key = keyOf(repo, e)
  const hit = known.get(key)
  if (hit && (hit.url || Date.now() - hit.at < MISS_MS)) return Promise.resolve(hit.url)
  return new Promise((resolve) => {
    const list = waiting.get(key)
    if (list) {
      list.push(resolve)
      return
    }
    waiting.set(key, [resolve])
    let people = queue.get(repo)
    if (!people) queue.set(repo, (people = new Map()))
    people.set(e, sha)
    timer ??= setTimeout(() => void flush(), 50)
  })
}

async function flush(): Promise<void> {
  timer = null
  const batches = [...queue]
  queue.clear()
  for (const [repo, people] of batches) {
    const asks = [...people].map(([email, sha]) => ({ email, sha }))
    for (let i = 0; i < asks.length; i += BATCH) {
      const part = asks.slice(i, i + BATCH)
      let found: Record<string, string> | null = null
      try {
        found = await api.getAuthorAvatars(repo, part)
      } catch {
        found = null
      }
      for (const a of part) {
        const key = keyOf(repo, a.email)
        const url = found?.[a.email] ?? null
        // A failure is asked again the next time the avatar shows.
        if (found) known.set(key, { url, at: Date.now() })
        for (const resolve of waiting.get(key) ?? []) resolve(url)
        waiting.delete(key)
      }
    }
  }
}

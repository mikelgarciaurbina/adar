// Authors' pictures from the hosting services, for repositories whose pull requests are on. What each one knows:
// GitHub links commits to accounts by any verified email (asked per commit, in one GraphQL question), GitLab
// answers by public email (/avatar), Bitbucket by the commit (Cloud: the linked account, Data Center: the linked
// user). Azure DevOps would need another token scope (Identity), so it gives none. Gravatar's pictures are never
// taken from them: Gravatar has been asked already, or was turned off.

import type { AuthorAsk } from '@shared/hosting'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const sameEmail = (v: unknown, email: string) => typeof v === 'string' && v.trim().toLowerCase() === email

/** At most this many authors per question to a provider. */
export const MAX_AVATAR_ASKS = 40

/** Public hosts pictures are fetched from without a sign-in: GitHub's and Atlassian's avatar stores. */
export const PUBLIC_AVATAR_HOSTS: readonly RegExp[] = [/^avatars\.githubusercontent\.com$/, /^avatar-management--avatars\.[a-z0-9-]+\.prod\.public\.atl-paas\.net$/]

/** An account's picture straight from its GitHub noreply address ("12345+login@users.noreply.github.com"). */
export function githubNoreplyAvatar(email: string): string | null {
  const id = /^(\d{1,12})\+[^@\s]+@users\.noreply\.github\.com$/i.exec(email)?.[1]
  return id ? `https://avatars.githubusercontent.com/u/${id}?s=64&v=4` : null
}

/** One GraphQL question for the commits' authors and committers (the shas are checked hex, so they are inlined). */
export function githubAvatarQuery(asks: readonly AuthorAsk[]): string {
  const person = 'email avatarUrl(size: 64) user { login }'
  const fields = asks
    .filter((a) => /^[0-9a-f]{40}$/.test(a.sha))
    .map((a, i) => `c${i}: object(oid: "${a.sha}") { ... on Commit { author { ${person} } committer { ${person} } } }`)
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(' ')} } }`
}

/** Email → picture from that answer, for people GitHub linked to an account (not the identicons it makes up). */
export function githubAvatars(data: unknown, asks: readonly AuthorAsk[]): Map<string, string> {
  const repo = obj(obj(data).repository)
  const out = new Map<string, string>()
  asks
    .filter((a) => /^[0-9a-f]{40}$/.test(a.sha))
    .forEach((a, i) => {
      const commit = obj(repo[`c${i}`])
      for (const who of [obj(commit.author), obj(commit.committer)]) {
        if (sameEmail(who.email, a.email) && str(obj(who.user).login) && str(who.avatarUrl)) {
          out.set(a.email, str(who.avatarUrl))
          break
        }
      }
    })
  return out
}

/** A picture kept on the service's own host (`base`'s origin), as an absolute URL; null for any other. */
function onHost(url: string, base: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url, base)
    return u.origin === new URL(base).origin ? u.href : null
  } catch {
    return null
  }
}

/** GitLab's /avatar answer, when the picture is one GitLab keeps itself. */
export function gitlabAvatar(answer: unknown, base: string): string | null {
  return onHost(str(obj(answer).avatar_url), base)
}

/** Bitbucket Cloud's commit: the author's account picture, when the commit is linked to an account. */
export function cloudCommitAvatar(commit: unknown, email: string): string | null {
  const author = obj(obj(commit).author)
  const address = /<([^<>\s]+)>\s*$/.exec(str(author.raw))?.[1]
  if (!sameEmail(address, email)) return null
  return str(obj(obj(obj(author.user).links).avatar).href) || null
}

/** Bitbucket Data Center's commit: the picture of the user its author or committer is linked to, on the server. */
export function serverCommitAvatar(commit: unknown, email: string, base: string): string | null {
  const c = obj(commit)
  for (const who of [obj(c.author), obj(c.committer)]) {
    if (sameEmail(who.emailAddress, email)) {
      const url = onHost(str(who.avatarUrl), base)
      if (url) return url
    }
  }
  return null
}

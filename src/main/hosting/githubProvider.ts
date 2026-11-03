// GitHub pull requests of one repository: GraphQL for the list, REST for the rest.

import { AdarError } from '@shared/errors'
import { PULLS_QUERY, githubProtected, pullCommitsFromRest, pullFromRest, pullsFromQuery } from '@shared/hosting'
import {
  ADD_REVIEW_MUTATION,
  ADD_THREAD_MUTATION,
  RESOLVE_MUTATION,
  REVIEW_EVENTS,
  REVIEW_QUERY,
  SUBMIT_REVIEW_MUTATION,
  UNRESOLVE_MUTATION,
  UNVIEWED_MUTATION,
  VIEWED_MUTATION,
  draftThread,
  reviewFromQuery
} from '@shared/review'
import { githubAvatarQuery, githubAvatars, githubNoreplyAvatar } from './avatars'
import type { GithubClient } from './github'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider } from './provider'

const PENDING_QUERY = `query AdarPending($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id reviews(states: PENDING, first: 1) { nodes { id } } } }
}`

export function githubProvider(client: GithubClient, at: HostingRemote, viewer: () => string): PullProvider {
  const repoPath = `/repos/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.name)}`
  /** The pull request's GraphQL id, and the id of the review the user started on the website and did not submit. */
  const pending = async (number: number): Promise<{ id: string; review: string | null }> => {
    const data = (await client.graphql(PENDING_QUERY, { owner: at.owner, name: at.name, number })) as {
      repository?: { pullRequest?: { id?: unknown; reviews?: { nodes?: Array<{ id?: unknown }> } } }
    } | null
    const pr = data?.repository?.pullRequest
    if (typeof pr?.id !== 'string') throw new AdarError({ message: `Pull request #${number} was not found on GitHub`, code: 'NOT_FOUND' })
    const review = pr.reviews?.nodes?.[0]?.id
    return { id: pr.id, review: typeof review === 'string' ? review : null }
  }
  const read = async (number: number) => {
    const pr = pullFromRest(await client.rest('GET', `${repoPath}/pulls/${number}`), viewer())
    if (!pr) throw new AdarError({ message: `Pull request #${number} could not be read`, code: 'UNKNOWN' })
    return pr
  }

  return {
    async list() {
      const data = await client.graphql(PULLS_QUERY, { owner: at.owner, name: at.name })
      const result = pullsFromQuery(data, at)
      if (!result) throw new AdarError({ message: `GitHub: ${at.owner}/${at.name} was not found, or this sign-in has no access to it`, code: 'NOT_FOUND' })
      return result
    },

    async commits(number) {
      return pullCommitsFromRest(await client.rest('GET', `${repoPath}/pulls/${number}/commits?per_page=100`))
    },

    async create(opts) {
      const created = await client.rest('POST', `${repoPath}/pulls`, { title: opts.title, body: opts.body, head: opts.head, base: opts.base, draft: opts.draft })
      const pr = pullFromRest(created, viewer())
      if (!pr) throw new AdarError({ message: 'GitHub created the pull request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async merge(number, method, headSha) {
      if (method === 'fast-forward') throw invalid('GitHub does not merge by fast-forwarding')
      if (!/^[0-9a-f]{40}$/i.test(headSha)) throw invalid('Invalid commit')
      try {
        await client.rest('PUT', `${repoPath}/pulls/${number}/merge`, { merge_method: method, sha: headSha.toLowerCase() })
      } catch (err) {
        if (err instanceof AdarError && /head branch was modified|sha/i.test(err.message)) throw changedSinceLooked('GitHub')
        throw err
      }
    },

    async source(number) {
      const pr = await read(number)
      // GitHub keeps every pull request's head at refs/pull/<n>/head on the base repository, forks included.
      return { headRef: pr.headRef, fork: pr.headFork ? { from: at.remote, ref: `refs/pull/${number}/head` } : null }
    },

    async mergeChecks() {
      return null
    },

    async protectedBranches() {
      // Anyone who can read the repository may ask; branches under rulesets count too.
      return unlessRefused(async () => githubProtected(await client.rest('GET', `${repoPath}/branches?protected=true&per_page=100`)))
    },

    async avatars(authors) {
      const out = new Map<string, string>()
      // github.com's noreply addresses carry the account's id: no question needed.
      const rest = authors.filter((a) => {
        const url = at.server ? null : githubNoreplyAvatar(a.email)
        if (url) out.set(a.email, url)
        return !url
      })
      if (!rest.length) return out
      const data = await unlessRefused(() => client.graphql(githubAvatarQuery(rest), { owner: at.owner, name: at.name }))
      for (const [email, url] of githubAvatars(data, rest)) out.set(email, url)
      return out
    },

    image: (url) => client.image(url),

    async review(number) {
      const data = reviewFromQuery(await client.graphql(REVIEW_QUERY, { owner: at.owner, name: at.name, number }))
      if (!data) throw new AdarError({ message: `Pull request #${number} was not found on GitHub`, code: 'NOT_FOUND' })
      return data
    },

    async reviewAction(number, action) {
      switch (action.kind) {
        case 'comment': {
          const c = action.comment
          const range = c.startLine && c.startLine < c.line ? { start_line: c.startLine, start_side: c.side } : {}
          await client.rest('POST', `${repoPath}/pulls/${number}/comments`, { body: c.body, commit_id: action.commit, path: c.path, line: c.line, side: c.side, ...range })
          return
        }
        case 'reply':
          await client.rest('POST', `${repoPath}/pulls/${number}/comments/${action.commentId}/replies`, { body: action.body })
          return
        case 'conversation':
          await client.rest('POST', `${repoPath}/issues/${number}/comments`, { body: action.body })
          return
        case 'resolve':
          await client.mutate(action.resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { input: { threadId: action.threadId } })
          return
        case 'viewed': {
          const { id } = await pending(number)
          await client.mutate(action.viewed ? VIEWED_MUTATION : UNVIEWED_MUTATION, { input: { pullRequestId: id, path: action.path } })
          return
        }
        case 'submit': {
          const { id, review } = await pending(number)
          const event = REVIEW_EVENTS[action.event]
          const body = action.body.trim() ? action.body : undefined
          if (!review) {
            await client.mutate(ADD_REVIEW_MUTATION, { input: { pullRequestId: id, commitOID: action.commit, event, body, threads: action.comments.map(draftThread) } })
            return
          }
          // A review started on the website: Adar's comments join it, then it is submitted with them.
          for (const c of action.comments) await client.mutate(ADD_THREAD_MUTATION, { input: { pullRequestReviewId: review, ...draftThread(c) } })
          await client.mutate(SUBMIT_REVIEW_MUTATION, { input: { pullRequestReviewId: review, event, body } })
          return
        }
      }
    }
  }
}

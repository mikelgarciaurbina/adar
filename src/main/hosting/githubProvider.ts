// GitHub pull requests of one repository: GraphQL for the list, REST for the rest.

import { AdarError } from '@shared/errors'
import { PULLS_QUERY, githubProtected, pullCommitsFromRest, pullFromRest, pullsFromQuery } from '@shared/hosting'
import type { GithubClient } from './github'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider } from './provider'

export function githubProvider(client: GithubClient, at: HostingRemote, viewer: () => string): PullProvider {
  const repoPath = `/repos/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.name)}`
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
    }
  }
}

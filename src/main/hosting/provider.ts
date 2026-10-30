// What every pull request provider (GitHub, GitLab, Bitbucket Cloud, Bitbucket Data Center) does for one
// repository. index.ts picks the provider from the repository's remote and the user's sign-ins.

import { AdarError } from '@shared/errors'
import type { CreatePullOptions, MergeChecks, MergeMethod, PullCommit, PullRequest, RepoPullRequests } from '@shared/hosting'
import type { RemoteHosting } from '@shared/remoteUrl'

/** A repository's remote with a supported hosting. */
export type HostingRemote = RemoteHosting & {
  /** Git remote name ("origin"). */
  remote: string
  /** Its URL, as configured. */
  url: string
}

/** Where a pull request's commits are fetched from to check it out. */
export interface PullSource {
  headRef: string
  /** From a fork: what to fetch (a remote name or a URL) and which ref; null when the branch is on the remote. */
  fork: { from: string; ref: string } | null
}

export interface PullProvider {
  list(): Promise<RepoPullRequests>
  commits(number: number): Promise<PullCommit[]>
  create(opts: CreatePullOptions): Promise<PullRequest>
  /** Refuses when the pull request's last commit is no longer `headSha`. */
  merge(number: number, method: MergeMethod, headSha: string): Promise<void>
  source(number: number): Promise<PullSource>
  /** What blocks a merge, when the provider says it (Bitbucket Data Center, GitLab); null otherwise. */
  mergeChecks(number: number): Promise<MergeChecks | null>
  /** Names and patterns ("release/*") of the branches the service protects; null when it would not say to this sign-in. */
  protectedBranches(): Promise<string[] | null>
}

export const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

export const changedSinceLooked = (service: string, noun = 'pull request') =>
  invalid(`The ${noun} changed on ${service} since Adar last looked. Check it again before merging.`)

/**
 * `ask()`, or null when the service refuses to answer this sign-in (such as a 403 for a reader): only connection
 * trouble, rate limits and the error codes not listed throw.
 */
export async function unlessRefused<T>(ask: () => Promise<T>, refused: readonly string[] = ['INVALID_ARGUMENT', 'NOT_FOUND']): Promise<T | null> {
  try {
    return await ask()
  } catch (err) {
    if (err instanceof AdarError && refused.includes(err.code)) return null
    throw err
  }
}

// What every pull request provider (GitHub, Bitbucket Cloud, Bitbucket Data Center) does for one
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
  /** What blocks a merge, when the provider says it (Bitbucket Data Center); null otherwise. */
  mergeChecks(number: number): Promise<MergeChecks | null>
}

export const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

export const changedSinceLooked = (service: string) => invalid(`The pull request changed on ${service} since Adar last looked. Check it again before merging.`)

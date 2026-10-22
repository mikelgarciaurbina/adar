import type { Ref, RefsResult, Stash } from '@shared/types'

export interface RefsAtCommit {
  branches: Ref[]
  remotes: Ref[]
  tags: Ref[]
  stashes: Stash[]
  isHead: boolean
}

/** Index refs by the commit sha they point to. */
export function refsBySha(refs: RefsResult | null): Map<string, RefsAtCommit> {
  const map = new Map<string, RefsAtCommit>()
  if (!refs) return map
  const get = (sha: string) => {
    let e = map.get(sha)
    if (!e) {
      e = { branches: [], remotes: [], tags: [], stashes: [], isHead: false }
      map.set(sha, e)
    }
    return e
  }
  for (const b of refs.branches) get(b.sha).branches.push(b)
  for (const r of refs.remotes) if (!r.isSymbolic) get(r.sha).remotes.push(r)
  for (const t of refs.tags) get(t.sha).tags.push(t)
  for (const s of refs.stashes) get(s.sha).stashes.push(s)
  if (refs.head.sha) get(refs.head.sha).isHead = true
  return map
}

/** Remote branch name without the remote prefix: "origin/feature/x" → "feature/x". */
export function remoteBranchName(ref: Ref): string {
  if (ref.remote && ref.name.startsWith(ref.remote + '/')) return ref.name.slice(ref.remote.length + 1)
  const i = ref.name.indexOf('/')
  return i >= 0 ? ref.name.slice(i + 1) : ref.name
}

/** Find the local branch tracking a remote branch, if any. */
export function localForRemote(refs: RefsResult | null, remote: Ref): Ref | undefined {
  return refs?.branches.find((b) => b.upstream === remote.name)
}

export function currentBranch(refs: RefsResult | null): Ref | undefined {
  return refs?.branches.find((b) => b.isHead)
}

/** Default remote: upstream remote of the current branch, else "origin", else the first remote. */
export function defaultRemote(refs: RefsResult | null, remoteNames: string[]): string | null {
  const cur = currentBranch(refs)
  if (cur?.upstream) {
    const r = remoteNames.find((n) => cur.upstream!.startsWith(n + '/'))
    if (r) return r
  }
  if (remoteNames.includes('origin')) return 'origin'
  return remoteNames[0] ?? null
}

/**
 * The repository's main local branch other than `exclude`: the one for the remote's default branch
 * (origin/HEAD), else main, master, develop or trunk, else the first branch.
 */
export function mainBranch(refs: RefsResult | null, exclude?: string): Ref | undefined {
  const branches = refs?.branches.filter((b) => b.name !== exclude) ?? []
  const heads = refs?.remotes.filter((r) => r.isSymbolic && r.target) ?? []
  const head = heads.find((r) => r.remote === 'origin') ?? heads[0]
  const byName = (name: string) => branches.find((b) => b.name === name)
  if (head?.target) {
    const local = branches.find((b) => b.upstream === head.target) ?? byName(remoteBranchName({ ...head, name: head.target }))
    if (local) return local
  }
  for (const name of ['main', 'master', 'develop', 'trunk']) {
    const b = byName(name)
    if (b) return b
  }
  return branches[0]
}

// What dropping one ref onto another offers (GitKraken semantics): merge brings the dragged ref
// into the drop target, and rebase always moves the CHECKED-OUT branch onto the other ref (when
// neither is checked out, the dragged branch is the one moved).

export interface DropRef {
  name: string
  type: 'branch' | 'remote' | 'tag'
  sha: string
  /** Full ref name (used when the short name is ambiguous, e.g. a branch and a tag both called "v1"). */
  fullName?: string
  /** Remote branches: the configured remote name (remote names may contain "/"). */
  remote?: string
}

export type RefDropAction =
  | { kind: 'fast-forward'; label: string; branch: string; to: string }
  | { kind: 'merge'; label: string; source: string; into?: string }
  | { kind: 'rebase'; label: string; branch: string; onto: string }
  | { kind: 'reset'; label: string; sha: string }
  | { kind: 'push'; label: string; branch: string; remote: string; remoteBranch: string }
  | { kind: 'separator' }

/**
 * `rev` turns a ref into the revision argument passed to git (short name unless ambiguous);
 * labels always use short names.
 */
export function refDropActions(
  source: DropRef,
  target: DropRef,
  currentBranch: string | null,
  rev: (r: DropRef) => string = (r) => r.name
): RefDropAction[] {
  if (source.name === target.name && source.type === target.type) return []
  const sourceIsHead = source.type === 'branch' && source.name === currentBranch
  const targetIsHead = target.type === 'branch' && target.name === currentBranch
  const main: RefDropAction[] = []
  const extra: RefDropAction[] = []

  if (target.type === 'branch') {
    // Nothing to fast-forward when both already point at the same commit.
    if (source.sha !== target.sha) {
      main.push({ kind: 'fast-forward', label: `Fast-forward ${target.name} to ${source.name}`, branch: target.name, to: rev(source) })
    }
    main.push({ kind: 'merge', label: `Merge ${source.name} into ${target.name}`, source: rev(source), into: target.name })
    if (targetIsHead) {
      main.push({ kind: 'rebase', label: `Rebase ${target.name} onto ${source.name}`, branch: target.name, onto: rev(source) })
      extra.push({ kind: 'reset', label: `Reset ${target.name} to ${source.name}…`, sha: source.sha })
    } else if (source.type === 'branch') {
      // The dragged branch moves (it is checked out first when it is not HEAD).
      main.push({ kind: 'rebase', label: `Rebase ${source.name} onto ${target.name}`, branch: source.name, onto: rev(target) })
    }
  } else {
    // Dropped on a remote branch or a tag.
    if (sourceIsHead) {
      main.push({ kind: 'rebase', label: `Rebase ${source.name} onto ${target.name}`, branch: source.name, onto: rev(target) })
    }
    if (currentBranch) {
      main.push({ kind: 'merge', label: `Merge ${target.name} into ${currentBranch}`, source: rev(target) })
    }
    if (source.type === 'branch' && target.type === 'remote') {
      const remote = target.remote && target.name.startsWith(target.remote + '/') ? target.remote : target.name.split('/')[0]
      extra.push({
        kind: 'push',
        label: `Push ${source.name} to ${target.name}`,
        branch: source.name,
        remote,
        remoteBranch: target.name.slice(remote.length + 1)
      })
    }
  }
  return extra.length ? [...main, { kind: 'separator' }, ...extra] : main
}

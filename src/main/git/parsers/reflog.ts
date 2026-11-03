// Reflogs and lost commits. Pure: the reflog lines, the lost commits git found and the branches that
// exist go in; the moves in words and the lost commits grouped by what left them behind come out.

import type { LostCommit, LostGroup, ReflogKind } from '@shared/types'

/** `git log -g --date=unix` format: ref and time (%gD), commit, git's words for the move, subject, author. */
export const REFLOG_FORMAT = '%gD%x00%H%x00%gs%x00%s%x00%an'
/** `git log` format of a lost commit. */
export const LOST_FORMAT = '%H%x00%P%x00%s%x00%an%x00%ae%x00%ct'

export interface RawMove {
  /** The reflog it is in: "HEAD" or "refs/heads/main". */
  ref: string
  sha: string
  date: number
  /** git's words ("reset: moving to HEAD~3"). */
  move: string
  subject: string
  author: string
}

const SHA = /^[0-9a-f]{40,64}$/

/** Lines of REFLOG_FORMAT, in git's order (each reflog newest first). */
export function parseReflog(out: string): RawMove[] {
  const moves: RawMove[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [selector = '', sha = '', move = '', subject = '', author = ''] = line.split('\0')
    const m = /^(.+)@\{(\d+)\}$/.exec(selector)
    if (!m || !SHA.test(sha)) continue
    moves.push({ ref: m[1], sha, date: Number(m[2]), move, subject, author })
  }
  return moves
}

/** Lines of LOST_FORMAT. */
export function parseLostCommits(out: string): LostCommit[] {
  const commits: LostCommit[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [sha = '', parents = '', subject = '', author = '', email = '', date = ''] = line.split('\0')
    if (!SHA.test(sha)) continue
    commits.push({ sha, parents: parents.split(' ').filter((p) => SHA.test(p)), subject, author, email, date: Number(date) || 0 })
  }
  return commits
}

/** What a move did, and git's words for it after its kind ("commit (amend): Fix" → amend, "Fix"); full commit ids shortened. */
export function describeMove(move: string): { kind: ReflogKind; detail: string } {
  const { kind, detail } = moveWords(move)
  return { kind, detail: detail.replace(/\b([0-9a-f]{7})[0-9a-f]{33,57}\b/g, '$1') }
}

function moveWords(move: string): { kind: ReflogKind; detail: string } {
  const m = /^([a-z-]+(?: -i| --rebase| --[a-z-]+)?)(?: \(([^)]*)\))?: ?(.*)$/i.exec(move)
  if (!m) {
    const merge = /^merge (.+)$/.exec(move)
    return merge ? { kind: 'merge', detail: merge[1] } : { kind: 'other', detail: move }
  }
  const [, rawVerb, variant = '', rest] = m
  const verb = rawVerb.toLowerCase()
  const detail = rest.replace(/refs\/heads\//g, '').trim()
  if (verb === 'commit') {
    if (variant === 'amend') return { kind: 'amend', detail }
    if (variant === 'merge') return { kind: 'merge', detail }
    return { kind: 'commit', detail }
  }
  if (verb.startsWith('rebase') || verb === 'pull --rebase') return { kind: 'rebase', detail: variant ? `${variant}${detail ? `: ${detail}` : ''}` : detail }
  if (verb.startsWith('pull')) return { kind: 'pull', detail }
  if (verb === 'reset' || verb === 'checkout' || verb === 'cherry-pick' || verb === 'revert' || verb === 'branch') return { kind: verb, detail }
  if (verb.startsWith('merge')) return { kind: 'merge', detail }
  return { kind: 'other', detail: move }
}

export interface GroupInput {
  /** Every reflog's moves (HEAD's and each local branch's), each reflog newest first. */
  moves: RawMove[]
  /** Commits no ref reaches (any order). */
  lost: LostCommit[]
  branches: ReadonlySet<string>
  /** gc.reflogExpireUnreachable in days; null: never. */
  expireDays: number | null
  /** Unix seconds. */
  now: number
}

const DAY = 86400

/**
 * Group lost commits by what left them behind. Each group starts at a lost commit no other lost commit
 * builds on (the one a branch or HEAD was on) and holds its lost ancestors. What left it behind is the
 * newest move away from it: in a branch's reflog for a reset or a rewrite, in HEAD's for leaving a branch
 * (deleted since) or a detached HEAD. Rewritten groups (amend, rebase) come last.
 */
export function groupLostCommits(input: GroupInput): Omit<LostGroup, 'canMoveBack'>[] {
  const lost = new Map(input.lost.map((c) => [c.sha, c]))
  if (!lost.size) return []
  const isParent = new Set<string>()
  for (const c of input.lost) for (const p of c.parents) if (lost.has(p)) isParent.add(p)

  // Each reflog's moves, newest first, with the commit it moved away from (the next older entry's).
  const byRef = new Map<string, RawMove[]>()
  for (const m of input.moves) {
    const list = byRef.get(m.ref)
    if (list) list.push(m)
    else byRef.set(m.ref, [m])
  }
  const awayFrom = (sha: string) => {
    let fromBranch: { ref: string; move: RawMove } | null = null
    let fromHead: { move: RawMove } | null = null
    for (const [ref, list] of byRef) {
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i + 1].sha !== sha || list[i].sha === sha) continue
        if (ref === 'HEAD') {
          if (!fromHead || list[i].date > fromHead.move.date) fromHead = { move: list[i] }
        } else if (!fromBranch || list[i].date > fromBranch.move.date) fromBranch = { ref, move: list[i] }
        break
      }
    }
    return { fromBranch, fromHead }
  }
  // Newest reflog entry pointing at each commit: git forgets lost commits that long after it.
  const lastSeen = new Map<string, number>()
  for (const m of input.moves) if ((lastSeen.get(m.sha) ?? 0) < m.date) lastSeen.set(m.sha, m.date)

  const tips = input.lost.filter((c) => !isParent.has(c.sha))
  const drafts = tips.map((tip) => {
    const { fromBranch, fromHead } = awayFrom(tip.sha)
    let kind: LostGroup['kind'] = 'other'
    let branch: string | null = null
    let move: RawMove | null = fromBranch?.move ?? fromHead?.move ?? null
    const branchMove = fromBranch ? describeMove(fromBranch.move.move).kind : null
    const headMove = fromHead ? describeMove(fromHead.move.move) : null
    if (branchMove === 'amend' || branchMove === 'rebase' || headMove?.kind === 'amend' || headMove?.kind === 'rebase') {
      kind = 'rewritten'
      branch = fromBranch ? fromBranch.ref.replace(/^refs\/heads\//, '') : null
      move = fromBranch && (branchMove === 'amend' || branchMove === 'rebase') ? fromBranch.move : fromHead!.move
    } else if (branchMove === 'reset' || (!fromBranch && headMove?.kind === 'reset')) {
      kind = 'reset'
      branch = fromBranch ? fromBranch.ref.replace(/^refs\/heads\//, '') : null
    } else if (headMove?.kind === 'checkout') {
      const left = /^moving from (.+) to (.+)$/.exec(headMove.detail)?.[1] ?? ''
      move = fromHead!.move
      if (/^[0-9a-f]{7,64}$/.test(left)) kind = 'detached'
      else if (left && !input.branches.has(left)) {
        kind = 'deleted'
        branch = left
      }
    }
    return { tip, kind, branch, move, date: move?.date ?? tip.date }
  })
  drafts.sort((a, b) => Number(a.kind === 'rewritten') - Number(b.kind === 'rewritten') || b.date - a.date)

  // Each lost commit goes to the first group that reaches it.
  const taken = new Set<string>()
  return drafts.map((d) => {
    const commits: LostCommit[] = []
    const queue = [d.tip.sha]
    while (queue.length) {
      const sha = queue.shift()!
      const c = lost.get(sha)
      if (!c || taken.has(sha)) continue
      taken.add(sha)
      commits.push(c)
      queue.push(...c.parents)
    }
    // The tip first (where the branch or HEAD was), then its lost ancestors, newest first.
    const [tip, ...older] = commits
    older.sort((a, b) => b.date - a.date)
    commits.splice(0, commits.length, tip, ...older)
    const seen = Math.max(...commits.map((c) => lastSeen.get(c.sha) ?? 0), d.move?.date ?? 0)
    const daysLeft = input.expireDays === null ? null : Math.max(0, input.expireDays - Math.floor((input.now - (seen || d.date)) / DAY))
    return {
      kind: d.kind,
      branch: d.branch,
      date: d.date,
      move: d.move?.move ?? '',
      to: d.move?.sha ?? null,
      commits,
      daysLeft,
      canRestore: d.kind === 'deleted' && !!d.branch && !input.branches.has(d.branch)
    }
  }).filter((g) => g.commits.length > 0)
}

/** gc.reflogExpireUnreachable in days ("30.days.ago", "2.weeks", "never"); git's default is 30. */
export function expireDays(value: string | null): number | null {
  const v = (value ?? '').trim().toLowerCase()
  if (!v) return 30
  if (v === 'never' || v === 'false') return null
  if (v === 'now' || v === 'all') return 0
  const m = /^(\d+)[.\s]*(day|week|month|year)s?/.exec(v)
  if (!m) return 30
  return Number(m[1]) * { day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day']
}

// The reflog (getReflog), commits no ref reaches any more found through it (getLostCommits), and commits
// no reflog remembers either (findDanglingCommits, git fsck).

import type { DanglingCommit, LostCommit, LostCommits, ReflogEntry } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { LOST_FORMAT, REFLOG_FORMAT, describeMove, expireDays, groupLostCommits, parseLostCommits, parseReflog, type RawMove } from '../parsers/reflog'
import { assertRepo, invalidArgument } from './common'

/** Moves read per call (HEAD's reflog of a busy repository can be long). */
const MAX_MOVES = 5000
/** Commits asked about at once (as arguments). */
const MAX_CANDIDATES = 4000
/** Lost commits listed at most. */
const MAX_LOST = 1000
const SHA = /^[0-9a-f]{40,64}$/

type ReflogOps = Pick<ReadOps, 'getReflog' | 'getLostCommits' | 'findDanglingCommits'>

export function createReflogOps(ctx: GitContext): ReflogOps {
  const readMoves = async (repo: string, refs: string[]): Promise<RawMove[]> => {
    const res = await ctx.git(repo, ['log', '-g', '--date=unix', '--no-show-signature', `--format=${REFLOG_FORMAT}`, '-n', String(MAX_MOVES), ...refs, '--'], {
      allowFailure: true
    })
    return res.code === 0 ? parseReflog(res.stdout) : []
  }

  const localBranches = async (repo: string): Promise<string[]> => {
    const res = await ctx.git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads'], { allowFailure: true })
    return res.code === 0 ? res.stdout.split('\n').filter((r) => r.startsWith('refs/heads/')) : []
  }

  /** The commits among `shas` (and their ancestors) that no branch, tag, remote branch, stash or HEAD reaches. */
  const unreachable = async (repo: string, shas: string[]): Promise<LostCommit[]> => {
    const candidates = [...new Set(shas.filter((s) => SHA.test(s)))].slice(0, MAX_CANDIDATES)
    if (!candidates.length) return []
    const res = await ctx.git(repo, ['log', `--format=${LOST_FORMAT}`, '--no-show-signature', '-n', String(MAX_LOST), '--ignore-missing', ...candidates, '--not', '--all', '--'], {
      allowFailure: true
    })
    return res.code === 0 ? parseLostCommits(res.stdout) : []
  }

  return {
    async getReflog(repo, ref) {
      await assertRepo(ctx, repo)
      if (ref !== null && (typeof ref !== 'string' || !/^[^-\s][^\s]*$/.test(ref) || ref.includes('..'))) throw invalidArgument('Invalid branch')
      const moves = await readMoves(repo, [ref === null ? 'HEAD' : `refs/heads/${ref}`])
      const lost = new Set((await unreachable(repo, moves.map((m) => m.sha))).map((c) => c.sha))
      return moves.map((m): ReflogEntry => ({ sha: m.sha, date: m.date, ...describeMove(m.move), subject: m.subject, author: m.author, lost: lost.has(m.sha) }))
    },

    async getLostCommits(repo): Promise<LostCommits> {
      await assertRepo(ctx, repo)
      const branches = await localBranches(repo)
      const [moves, config] = await Promise.all([
        readMoves(repo, ['HEAD', ...branches]),
        ctx.git(repo, ['config', '--get', 'gc.reflogExpireUnreachable'], { allowFailure: true })
      ])
      const lost = await unreachable(repo, moves.map((m) => m.sha))
      const days = expireDays(config.code === 0 ? config.stdout : null)
      const names = new Set(branches.map((b) => b.slice('refs/heads/'.length)))
      const groups = groupLostCommits({ moves, lost, branches: names, expireDays: days, now: Math.floor(Date.now() / 1000) })
      // A reset branch can go back when nothing it has now would be left behind.
      const withMoveBack = await Promise.all(
        groups.map(async (g) => {
          if (g.kind !== 'reset' || !g.branch || !names.has(g.branch)) return { ...g, canMoveBack: false }
          const res = await ctx.git(repo, ['merge-base', '--is-ancestor', `refs/heads/${g.branch}`, g.commits[0].sha], { allowFailure: true })
          return { ...g, canMoveBack: res.code === 0 }
        })
      )
      return { groups: withMoveBack, expireDays: days }
    },

    async findDanglingCommits(repo): Promise<DanglingCommit[]> {
      await assertRepo(ctx, repo)
      // --no-reflogs: commits only a reflog remembers count as dangling too; the renderer leaves out those it already shows.
      const fsck = await ctx.git(repo, ['fsck', '--no-reflogs', '--no-progress', '--dangling'], { allowFailure: true, timeoutMs: 10 * 60_000 })
      const shas = [...fsck.stdout.matchAll(/^dangling commit ([0-9a-f]{40,64})$/gm)].map((m) => m[1]).slice(0, 500)
      if (!shas.length) return []
      const res = await ctx.git(repo, ['log', '--no-walk', `--format=${LOST_FORMAT}`, '--no-show-signature', ...shas, '--'], { allowFailure: true })
      if (res.code !== 0) return []
      return parseLostCommits(res.stdout).map((c) => ({
        sha: c.sha,
        subject: c.subject,
        author: c.author,
        date: c.date,
        stash: c.parents.length >= 2 && /^(WIP on|On) [^:]+: /.test(c.subject)
      }))
    }
  }
}

// getRefs: branches, remote branches, tags, stashes, submodules and HEAD.

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RefsResult, Submodule } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import {
  FOR_EACH_REF_FORMAT,
  FOR_EACH_REF_FORMAT_NO_TRACK,
  STASH_FORMAT,
  applyTracking,
  buildSubmodules,
  parseAheadBehind,
  parseForEachRef,
  parseGitmodulesConfig,
  parseRefValues,
  parseStashList,
  parseSubmoduleStatus,
  parseTrack,
  sortBranches,
  sortByName,
  type ParsedRefs,
  type TrackInfo
} from '../parsers/refs'
import { chunkedPathspecs, gitAtLeast } from '../write/util'
import { assertRepo, failed, readHead } from './common'

/** Upstream names safe to embed in a %(ahead-behind:...) atom. */
const SIMPLE_REF = /^refs\/(heads|remotes|tags)\/[\w./-]+$/

/**
 * Ahead/behind counts of local branches vs their upstreams. %(upstream:track) runs one
 * revision walk per branch (seconds with hundreds of stale tracking branches); branches
 * sharing an upstream are computed in one batched walk with %(ahead-behind:<upstream>)
 * (git 2.41+). Upstreams that no longer exist are reported as gone.
 */
export async function computeTracking(ctx: GitContext, repo: string, parsed: ParsedRefs): Promise<Map<string, TrackInfo>> {
  const result = new Map<string, TrackInfo>()
  const known = new Set<string>()
  for (const list of [parsed.branches, parsed.remotes, parsed.tags]) for (const r of list) known.add(r.fullName)

  const groups = new Map<string, string[]>()
  const singles: string[] = []
  for (const b of parsed.branches) {
    const up = parsed.upstreamOf.get(b.fullName)
    if (!up) continue
    if (/^refs\/(heads|remotes|tags)\//.test(up) && !known.has(up)) {
      result.set(b.fullName, { ahead: 0, behind: 0, gone: true })
      continue
    }
    if (!SIMPLE_REF.test(up)) {
      singles.push(b.fullName)
      continue
    }
    const g = groups.get(up)
    if (g) g.push(b.fullName)
    else groups.set(up, [b.fullName])
  }

  const query = async (format: string, refs: string[], apply: (ref: string, value: string) => void) => {
    await chunkedPathspecs(refs, async (chunk) => {
      const res = await ctx.git(repo, ['for-each-ref', `--format=${format}`, ...chunk], { allowFailure: true })
      if (res.code !== 0) return
      for (const [ref, value] of parseRefValues(res.stdout)) apply(ref, value)
    })
  }
  const jobs: Promise<void>[] = []
  for (const [up, refs] of groups) {
    if (refs.length < 2) {
      singles.push(...refs)
      continue
    }
    jobs.push(
      query(`%(refname)%00%(ahead-behind:${up})`, refs, (ref, value) => {
        const t = parseAheadBehind(value)
        if (t) result.set(ref, t)
      })
    )
  }
  if (singles.length) {
    jobs.push(query('%(refname)%00%(upstream:track)', singles, (ref, value) => result.set(ref, parseTrack(value))))
  }
  await Promise.all(jobs)
  return result
}

async function readSubmodules(ctx: GitContext, repo: string): Promise<Submodule[]> {
  if (!existsSync(path.join(repo, '.gitmodules'))) return []
  const [status, config] = await Promise.all([
    ctx.git(repo, ['submodule', 'status'], { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } }),
    ctx.git(repo, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$'], { allowFailure: true })
  ])
  const urls = parseGitmodulesConfig(config.stdout)
  return buildSubmodules(parseSubmoduleStatus(status.stdout), urls, status.code !== 0)
}

export function createRefsOps(ctx: GitContext): Pick<ReadOps, 'getRefs'> {
  return {
    async getRefs(repo): Promise<RefsResult> {
      await assertRepo(ctx, repo)
      const batched = await gitAtLeast(ctx, 2, 41)
      const format = batched ? FOR_EACH_REF_FORMAT_NO_TRACK : FOR_EACH_REF_FORMAT
      const refArgs = ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes', 'refs/tags']
      const [refsRes, remotesRes, stashRes, head, submodules] = await Promise.all([
        ctx.git(repo, refArgs, { allowFailure: true }),
        ctx.git(repo, ['remote'], { allowFailure: true }),
        ctx.git(repo, ['stash', 'list', `--format=${STASH_FORMAT}`], { allowFailure: true }),
        readHead(ctx, repo),
        readSubmodules(ctx, repo).catch(() => [] as Submodule[])
      ])
      if (refsRes.code !== 0) failed(refArgs, refsRes)
      const remoteNames = remotesRes.code === 0 ? remotesRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : []
      const parsed = parseForEachRef(refsRes.stdout, remoteNames)
      if (batched && parsed.upstreamOf.size) applyTracking(parsed.branches, await computeTracking(ctx, repo, parsed))
      return {
        head,
        branches: sortBranches(parsed.branches),
        remotes: sortByName(parsed.remotes),
        tags: sortByName(parsed.tags),
        stashes: stashRes.code === 0 ? parseStashList(stashRes.stdout) : [],
        submodules
      }
    }
  }
}

// Repository lifecycle: open / close / init / clone / info.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RepoInfo } from '@shared/types'
import type { ReadOps } from '../ops'
import type { GitContext } from '../context'
import { parseRemotesVerbose } from '../parsers/refs'
import type { SystemServices } from '../../system'
import { assertRepo, clampInt, expandHome, failed, invalidArgument, locateRepo, notFound, readHead } from './common'

/**
 * Directory name git would pick for a clone URL:
 *   https://host/org/repo.git → repo, git@host:org/repo.git → repo,
 *   ssh://git@host:22/org/repo/ → repo, /srv/git/repo.git → repo, C:\src\repo → repo.
 */
export function deriveCloneDirName(url: string): string {
  let s = url.trim()
  s = s.replace(/[?#].*$/, '')
  s = s.replace(/[\\/]+$/, '')
  s = s.replace(/\.git$/i, '')
  s = s.replace(/[\\/]+$/, '')
  s = s.replace(/\.bundle$/i, '')
  const m = /[^/\\:]+$/.exec(s)
  const name = (m ? m[0] : '').replace(/[\0<>:"|?*]/g, '-').trim()
  if (!name || name === '.' || name === '..') {
    throw invalidArgument(`Cannot derive a folder name from "${url}". Enter a folder name.`)
  }
  return name
}

function validateCloneUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) throw invalidArgument('Repository URL is required')
  const u = url.trim()
  if (u.startsWith('-') || /[\0\n\r]/.test(u)) throw invalidArgument(`Invalid repository URL: "${u}"`)
  return u
}

function validateDirName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || /[\\/\0]/.test(n)) throw invalidArgument(`Invalid folder name: "${name}"`)
  return n
}

async function isNonEmptyDir(p: string): Promise<'missing' | 'empty' | 'non-empty' | 'file'> {
  try {
    const st = await fs.stat(p)
    if (!st.isDirectory()) return 'file'
    const entries = await fs.readdir(p)
    return entries.length ? 'non-empty' : 'empty'
  } catch {
    return 'missing'
  }
}

type RepoOps = Pick<ReadOps, 'openRepo' | 'closeRepo' | 'initRepo' | 'cloneRepo' | 'getRepoInfo'>

export function createRepoOps(ctx: GitContext, services: SystemServices): RepoOps {
  const getRepoInfo = async (repo: string): Promise<RepoInfo> => {
    const gitDir = await assertRepo(ctx, repo)
    const [bare, head, state, remotes] = await Promise.all([
      ctx.git(repo, ['rev-parse', '--is-bare-repository'], { allowFailure: true }),
      readHead(ctx, repo),
      ctx.operationState(repo),
      ctx.git(repo, ['remote', '-v'], { allowFailure: true })
    ])
    const root = repo.length > 1 ? repo.replace(/[\\/]+$/, '') : repo
    return {
      path: root,
      name: path.basename(root) || root,
      gitDir,
      isBare: bare.stdout.trim() === 'true',
      head,
      state,
      remotes: remotes.code === 0 ? parseRemotesVerbose(remotes.stdout) : []
    }
  }

  const openRepo = async (p: string): Promise<RepoInfo> => {
    if (typeof p !== 'string' || !p.trim()) throw invalidArgument('Choose a folder to open')
    let dir = path.resolve(expandHome(p.trim()))
    let st
    try {
      st = await fs.stat(dir)
    } catch {
      throw notFound(`Folder not found: ${dir}`)
    }
    if (!st.isDirectory()) dir = path.dirname(dir)
    const loc = await locateRepo(ctx, dir)
    const info = await getRepoInfo(loc.root)
    services.watcher.start({ repoPath: info.path, gitDir: loc.gitDir, commonDir: loc.commonDir, isBare: loc.isBare })
    await services.settings.addRecentRepo(info.path, info.name).catch(() => undefined)
    return info
  }

  return {
    getRepoInfo,
    openRepo,

    async closeRepo(repo) {
      if (typeof repo !== 'string') return
      services.watcher.stop(repo)
      ctx.forgetRepo(repo)
    },

    async initRepo(p, opts = {}) {
      if (typeof p !== 'string' || !p.trim()) throw invalidArgument('Choose a folder for the new repository')
      const branch = (opts.initialBranch ?? 'main').trim() || 'main'
      if (branch.startsWith('-')) throw invalidArgument(`Invalid branch name: "${branch}"`)
      const check = await ctx.gitGlobal(['check-ref-format', '--branch', branch], { allowFailure: true })
      if (check.code !== 0) throw invalidArgument(`Invalid branch name: "${branch}"`)
      const dir = path.resolve(expandHome(p.trim()))
      await fs.mkdir(dir, { recursive: true })
      const res = await ctx.gitGlobal(['init', '-b', branch, dir], { cwd: dir, allowFailure: true })
      if (res.code !== 0) {
        // git < 2.28 has no -b: init, then point HEAD at the branch.
        if (/unknown switch|unknown option|usage:/i.test(res.stderr)) {
          await ctx.gitGlobal(['init', dir], { cwd: dir })
          await ctx.gitGlobal(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir })
        } else {
          failed(['init', '-b', branch, dir], res)
        }
      }
      return openRepo(dir)
    },

    async cloneRepo(url, parentDir, opts = {}) {
      const u = validateCloneUrl(url)
      if (typeof parentDir !== 'string' || !parentDir.trim()) throw invalidArgument('Choose where to clone the repository')
      const parent = path.resolve(expandHome(parentDir.trim()))
      const name = opts.dirName && opts.dirName.trim() ? validateDirName(opts.dirName) : deriveCloneDirName(u)
      const target = path.join(parent, name)
      const existing = await isNonEmptyDir(target)
      if (existing === 'file' || existing === 'non-empty') {
        throw invalidArgument(`"${target}" already exists and is not an empty folder. Choose another name or location.`)
      }
      await fs.mkdir(parent, { recursive: true })
      const args = ['clone', '--progress']
      if (opts.depth !== undefined && opts.depth !== null) {
        const depth = clampInt(opts.depth, 0, 0, 1_000_000_000)
        if (depth > 0) args.push('--depth', String(depth))
      }
      args.push('--', u, target)
      await ctx.gitNetwork(null, args, { opId: opts.opId, cwd: parent })
      return openRepo(target)
    }
  }
}

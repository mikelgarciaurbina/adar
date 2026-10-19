// Conflict inspection and resolution.

import { isUtf8 } from 'node:buffer'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { ConflictVersions } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import {
  kindFromStages,
  kindFromXY,
  looksBinary,
  mergeSourceFromMessage,
  mergeSourceUrl,
  parseUnmergedEntries,
  unmergedXY,
  type StageEntry
} from './conflictParse'
import {
  currentBranch,
  describeCommit,
  invalid,
  LITERAL_ENV,
  notFound,
  O_NOFOLLOW,
  PATHSPEC_STDIN,
  pathspecInput,
  readWorktreeEntry,
  repoPath,
  repoPaths,
  safeResolve
} from './util'

type ConflictOps = Pick<WriteOps, 'getConflictVersions' | 'resolveConflict' | 'markResolved'>

/** Literal pathspecs, and no opportunistic index refresh (`git status` would take index.lock for a read). */
const READ_ENV: Record<string, string> = { ...LITERAL_ENV, GIT_OPTIONAL_LOCKS: '0' }

/** Index mode of a symbolic link. */
const SYMLINK_MODE = '120000'

/** Text that would not survive a UTF-8 decode / encode round trip (binary files are reported as such instead). */
function notUtf8Text(buf: Buffer | null): boolean {
  return buf !== null && !looksBinary(buf) && !isUtf8(buf)
}

/** Git-style form of a repo-relative path (as printed by ls-files / status). */
function gitPathForm(p: string): string {
  const s = process.platform === 'win32' ? p.replace(/\\/g, '/') : p
  return path.posix.normalize(s).replace(/^\.\//, '')
}

export function createConflictOps(ctx: GitContext): ConflictOps {
  const stagesOf = async (repo: string, rel: string): Promise<Map<number, StageEntry>> => {
    const res = await ctx.git(repo, ['ls-files', '-u', '-z', '--', rel], { env: READ_ENV })
    const want = gitPathForm(rel)
    const map = new Map<number, StageEntry>()
    for (const e of parseUnmergedEntries(res.stdout)) if (e.path === want) map.set(e.stage, e)
    return map
  }

  const readStage = async (repo: string, entry: StageEntry | undefined): Promise<Buffer | null> => {
    if (!entry) return null
    // Submodule conflicts store commits, not blobs.
    if (entry.mode === '160000') return Buffer.from(`Subproject commit ${entry.sha}\n`, 'utf8')
    const res = await ctx.git(repo, ['cat-file', 'blob', entry.sha], { binary: true, allowFailure: true })
    return res.code === 0 ? (res.stdoutBuffer ?? Buffer.from(res.stdout, 'utf8')) : null
  }

  /**
   * Working-tree version, never following a symbolic link (a link's target string stands in for its
   * content, so the version still counts as present). data is null when absent or not a file / link.
   */
  const readWorktree = async (repo: string, rel: string): Promise<{ data: Buffer | null; symlink: boolean }> => {
    try {
      const entry = await readWorktreeEntry(await safeResolve(repo, rel))
      if (entry.type === 'file') return { data: entry.data, symlink: false }
      if (entry.type === 'symlink') return { data: Buffer.from(entry.target, 'utf8'), symlink: true }
    } catch {
      /* unreadable or outside the repository */
    }
    return { data: null, symlink: false }
  }

  const nameCache = new Map<string, string | null>()

  /**
   * Short branch-ish name for a commit, preferring local branches, then remote
   * ones, then tags. Refs pointing exactly at the commit are found cheaply with
   * for-each-ref; only otherwise does name-rev walk the history ("main~2").
   */
  const nameRev = async (repo: string, sha: string): Promise<string | null> => {
    const key = `${repo}\0${sha}`
    if (nameCache.has(key)) return nameCache.get(key) ?? null
    let name: string | null = null
    const exact = await ctx.git(
      repo,
      ['for-each-ref', `--points-at=${sha}`, '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'],
      { allowFailure: true }
    )
    const refs = exact.code === 0 ? exact.stdout.split('\n').map((l) => l.trim()).filter((r) => r && !r.endsWith('/HEAD')) : []
    for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
      const hit = refs.find((r) => r.startsWith(prefix))
      if (hit) {
        name = hit.slice(prefix.length)
        break
      }
    }
    for (const pattern of name ? [] : ['refs/heads/*', 'refs/remotes/*']) {
      const res = await ctx.git(repo, ['name-rev', '--name-only', '--no-undefined', `--refs=${pattern}`, sha], { allowFailure: true })
      const out = res.stdout.trim()
      if (res.code === 0 && out && out !== 'undefined') {
        name = out.replace(/^remotes\//, '').replace(/\^0$/, '')
        break
      }
    }
    if (nameCache.size > 200) nameCache.clear()
    nameCache.set(key, name)
    return name
  }

  const shortSha = async (repo: string, rev: string): Promise<string | null> => {
    const res = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', '--short', rev], { allowFailure: true })
    return res.code === 0 ? res.stdout.trim() || null : null
  }

  const remoteForUrl = async (repo: string, url: string): Promise<string | null> => {
    const res = await ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'], { allowFailure: true })
    // fmt-merge-msg drops a trailing ".git" / "/" from the URL.
    const norm = (u: string) => u.trim().replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
    for (const line of res.stdout.split('\n')) {
      const m = /^remote\.(.+)\.url (.*)$/.exec(line.trim())
      if (m && norm(m[2]) === norm(url)) return m[1]
    }
    return null
  }

  const readGitFile = async (repo: string, rel: string): Promise<string | null> => {
    try {
      return await fs.readFile(path.join(await ctx.gitDir(repo), rel), 'utf8')
    } catch {
      return null
    }
  }

  const headLabel = async (repo: string): Promise<string> =>
    (await currentBranch(ctx, repo)) ?? (await shortSha(repo, 'HEAD')) ?? 'HEAD'

  const labels = async (repo: string): Promise<{ oursLabel: string; theirsLabel: string }> => {
    const [state, head] = await Promise.all([ctx.operationState(repo), headLabel(repo)])
    switch (state) {
      case 'merge': {
        const msg = (await readGitFile(repo, 'MERGE_MSG')) ?? ''
        let fromMsg = mergeSourceFromMessage(msg)
        // `git pull` writes "Merge branch 'main' of <url>": show it as <remote>/main.
        const url = mergeSourceUrl(msg)
        if (fromMsg && url) {
          const remote = await remoteForUrl(repo, url)
          if (remote) fromMsg = `${remote}/${fromMsg}`
        }
        const mergeHead = ((await readGitFile(repo, 'MERGE_HEAD')) ?? '').split('\n')[0].trim()
        const theirs = fromMsg ?? (mergeHead ? ((await nameRev(repo, mergeHead)) ?? mergeHead.slice(0, 7)) : null)
        return { oursLabel: head, theirsLabel: theirs ?? 'Incoming' }
      }
      case 'rebase':
      case 'rebase-interactive': {
        const onto = ((await readGitFile(repo, 'rebase-merge/onto')) ?? (await readGitFile(repo, 'rebase-apply/onto')) ?? '').trim()
        const ontoName = onto ? ((await nameRev(repo, onto)) ?? onto.slice(0, 7)) : null
        const applying = await describeCommit(ctx, repo, 'REBASE_HEAD')
        const headName = ((await readGitFile(repo, 'rebase-merge/head-name')) ?? '').trim().replace(/^refs\/heads\//, '')
        return {
          oursLabel: ontoName ? `${ontoName} (upstream)` : 'Upstream',
          theirsLabel: applying ?? (headName && headName !== 'detached HEAD' ? headName : 'Commit being rebased')
        }
      }
      case 'cherry-pick':
        return { oursLabel: head, theirsLabel: (await describeCommit(ctx, repo, 'CHERRY_PICK_HEAD')) ?? 'Cherry-picked commit' }
      case 'revert': {
        const s = await shortSha(repo, 'REVERT_HEAD')
        return { oursLabel: head, theirsLabel: s ? `revert of ${s}` : 'Revert' }
      }
      default:
        return { oursLabel: head, theirsLabel: 'Incoming' }
    }
  }

  return {
    async getConflictVersions(repo, p): Promise<ConflictVersions> {
      const rel = repoPath(repo, p)
      const stages = await stagesOf(repo, rel)
      if (!stages.size) throw notFound(`${rel} is not in conflict`)

      const [base, ours, theirs, worktree, status, names] = await Promise.all([
        readStage(repo, stages.get(1)),
        readStage(repo, stages.get(2)),
        readStage(repo, stages.get(3)),
        readWorktree(repo, rel),
        ctx.git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=no', '--', rel], { env: READ_ENV, allowFailure: true }),
        labels(repo)
      ])
      const merged = worktree.data
      const kind = kindFromXY(unmergedXY(status.stdout, gitPathForm(rel)) ?? '') ?? kindFromStages(new Set(stages.keys()))
      const versions = [base, ours, theirs, merged]
      // Only whole-side resolutions (checkout --ours/--theirs, rm) keep these intact:
      //  - binary content;
      //  - text that is not valid UTF-8 (Latin-1, Shift-JIS...): the editor's UTF-8 round trip would turn
      //    every such byte of the file into U+FFFD;
      //  - symbolic links: the editor would replace the link with a regular file (or, reading through
      //    it, with the content of the file it points to).
      const nonUtf8 = !versions.some(looksBinary) && versions.some(notUtf8Text)
      const symlink = worktree.symlink || [...stages.values()].some((e) => e.mode === SYMLINK_MODE)
      const binary = nonUtf8 || symlink || versions.some(looksBinary)
      // Binary versions are reported as '' (present) / null (absent): the UI offers ours/theirs only.
      const text = (b: Buffer | null) => (b === null ? null : binary ? '' : b.toString('utf8'))
      return {
        path: rel,
        kind,
        base: text(base),
        ours: text(ours),
        theirs: text(theirs),
        merged: text(merged),
        oursLabel: names.oursLabel,
        theirsLabel: names.theirsLabel,
        binary,
        ...(nonUtf8 ? { nonUtf8: true } : {}),
        ...(symlink ? { symlink: true } : {})
      }
    },

    async resolveConflict(repo, p, resolution) {
      const rel = repoPath(repo, p)
      if (!resolution || typeof resolution !== 'object') throw invalid('Invalid conflict resolution')
      await ctx.exclusive(repo, async () => {
        switch (resolution.kind) {
          case 'ours':
          case 'theirs': {
            const stages = await stagesOf(repo, rel)
            if (!stages.size) throw notFound(`${rel} is not in conflict`)
            if (stages.has(resolution.kind === 'ours' ? 2 : 3)) {
              await ctx.git(repo, ['checkout', `--${resolution.kind}`, '--', rel], { env: LITERAL_ENV })
              await ctx.git(repo, ['add', '--', rel], { env: LITERAL_ENV })
            } else {
              // That side deleted the file.
              await ctx.git(repo, ['rm', '-q', '-f', '--', rel], { env: LITERAL_ENV })
            }
            return
          }
          case 'content': {
            const { content, expected } = resolution
            if (typeof content !== 'string') throw invalid('Missing resolved content')
            if (expected !== undefined && expected !== null && typeof expected !== 'string') throw invalid('Invalid expected content')
            const abs = await safeResolve(repo, rel)
            const stages = await stagesOf(repo, rel)
            if ([...stages.values()].some((e) => e.mode === SYMLINK_MODE)) {
              throw invalid(`${rel} is a symbolic link in this conflict: resolve it by choosing one side`)
            }
            const current = await readWorktree(repo, rel)
            const currentText = current.symlink ? null : current.data
            // Text decoded from non-UTF-8 bytes carries U+FFFD in their place: writing it back would
            // replace every such byte of the file.
            if (content.includes('\uFFFD')) {
              const sources = await Promise.all([...stages.values()].map((e) => readStage(repo, e)))
              if ([...sources, currentText].some(notUtf8Text)) {
                throw invalid(`${rel} is not UTF-8 text: saving edited text would replace its bytes. Choose a whole side instead.`)
              }
            }
            // Lost-update guard: the editor built `content` from `expected`; refuse when the file was
            // edited elsewhere since (e.g. in an external editor), instead of silently overwriting it.
            if (expected !== undefined) {
              const same =
                expected === null
                  ? current.data === null
                  : currentText !== null && currentText.equals(Buffer.from(expected, 'utf8'))
              if (!same) {
                throw new AdarError({
                  message: `${rel} changed on disk since it was loaded. Reload it before saving the resolution.`,
                  code: 'CONFLICT'
                })
              }
            }
            try {
              const st = await fs.lstat(abs)
              if (st.isDirectory()) throw invalid(`${rel} is a directory`)
              // Never write through a symbolic link.
              if (st.isSymbolicLink()) await fs.unlink(abs)
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
            }
            await fs.mkdir(path.dirname(abs), { recursive: true })
            const handle = await fs.open(abs, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW, 0o666)
            try {
              await handle.writeFile(content, 'utf8')
            } finally {
              await handle.close()
            }
            await ctx.git(repo, ['add', '--', rel], { env: LITERAL_ENV })
            return
          }
          case 'delete':
            await ctx.git(repo, ['rm', '-q', '-f', '--', rel], { env: LITERAL_ENV })
            return
          default:
            throw invalid(`Invalid conflict resolution: ${String((resolution as { kind?: unknown }).kind)}`)
        }
      })
    },

    async markResolved(repo, paths) {
      const list = repoPaths(repo, paths)
      if (!list.length) return
      await ctx.exclusive(repo, async () => {
        await ctx.git(repo, ['add', '-A', ...PATHSPEC_STDIN], { input: pathspecInput(list), env: LITERAL_ENV })
      })
    }
  }
}

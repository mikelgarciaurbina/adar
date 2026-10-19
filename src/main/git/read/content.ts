// getFileContent: a file at a revision, in the index, or in the working tree.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ContentRev, FileContent } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { looksBinary } from '../parsers/util'
import { assertRepo, invalidArgument, validateRelPath, validateRev } from './common'

/** Binary files up to this size are returned as base64. */
export const MAX_BINARY_BYTES = 10 * 1024 * 1024
/** Text files above this size are reported as binary without data. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024

export function contentFromBuffer(p: string, rev: ContentRev, buf: Buffer, size = buf.length): FileContent {
  if (looksBinary(buf)) {
    const out: FileContent = { path: p, rev, exists: true, binary: true, size }
    if (size <= MAX_BINARY_BYTES) out.base64 = buf.toString('base64')
    return out
  }
  if (size > MAX_TEXT_BYTES) return { path: p, rev, exists: true, binary: true, size }
  return { path: p, rev, exists: true, binary: false, text: buf.toString('utf8'), size }
}

function missing(p: string, rev: ContentRev): FileContent {
  return { path: p, rev, exists: false, binary: false, size: 0 }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function readWorktree(repo: string, p: string, rel: string): Promise<FileContent> {
  const root = path.resolve(repo)
  const abs = path.resolve(root, rel)
  if (!isInside(root, abs)) throw invalidArgument('Path is outside the repository')
  // Symlinked parent directories must not lead outside the repository either.
  try {
    const [realRoot, realParent] = await Promise.all([fs.realpath(root), fs.realpath(path.dirname(abs))])
    if (!isInside(realRoot, realParent)) throw invalidArgument('Path is outside the repository')
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return missing(p, 'WORKTREE')
    throw err
  }
  let st
  try {
    st = await fs.lstat(abs)
  } catch {
    return missing(p, 'WORKTREE')
  }
  if (st.isSymbolicLink()) {
    // Like git: a symlink's content is its target path (never follow it).
    const target = await fs.readlink(abs)
    const buf = Buffer.from(target, 'utf8')
    return contentFromBuffer(p, 'WORKTREE', buf, buf.length)
  }
  if (!st.isFile()) return missing(p, 'WORKTREE')
  if (st.size > MAX_BINARY_BYTES) return { path: p, rev: 'WORKTREE', exists: true, binary: true, size: st.size }
  const buf = await fs.readFile(abs)
  return contentFromBuffer(p, 'WORKTREE', buf, buf.length)
}

export function createContentOps(ctx: GitContext): Pick<ReadOps, 'getFileContent'> {
  return {
    async getFileContent(repo, p, rev): Promise<FileContent> {
      await assertRepo(ctx, repo)
      const rel = validateRelPath(p)
      if (rev === 'WORKTREE') return readWorktree(repo, p, rel)
      // ":0:<path>" (stage 0) rather than ":<path>" so names like "1:x" are never read as a stage.
      const spec = rev === 'INDEX' ? `:0:${rel}` : `${validateRev(rev)}:${rel}`
      const check = await ctx.git(repo, ['cat-file', '--batch-check'], { input: spec + '\n', allowFailure: true })
      // "<sha> <type> <size>" or "<spec> missing"
      const m = /^([0-9a-f]{7,64}) (\w+) (\d+)\s*$/.exec(check.stdout.trim())
      if (check.code !== 0 || !m || m[2] !== 'blob') return missing(p, rev)
      const size = Number(m[3])
      if (size > MAX_BINARY_BYTES) return { path: p, rev, exists: true, binary: true, size }
      const blob = await ctx.git(repo, ['cat-file', 'blob', m[1]], { binary: true, allowFailure: true })
      if (blob.code !== 0 || !blob.stdoutBuffer) return missing(p, rev)
      return contentFromBuffer(p, rev, blob.stdoutBuffer, size)
    }
  }
}

// Where a line of a pull request's diff sits on both sides, as the repository's own diff (base..head) says. Adar's
// review view knows the side and the line a comment is on; GitLab places a comment by its old and new line numbers
// (and the old path of a renamed file), Bitbucket Data Center by whether the line was added, removed or kept.

import type { GitContext } from '../git/context'
import { LITERAL_PATHSPECS } from '../git/read/common'
import { parseNameStatusZ } from '../git/parsers/files'
import { invalid, type FileLines, type PlacedLine } from './provider'

export interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

/** The hunks of `git diff -U0` output. */
export function hunksOf(diff: string): Hunk[] {
  const out: Hunk[] = []
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({ oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]) })
  }
  return out
}

/**
 * Where `line` of `side` is on both sides, given the file's hunks without context (-U0). A hunk's removed lines come
 * before its added ones, as in any unified diff; with no lines on a side, its start is the line before the change.
 */
export function placeLine(hunks: readonly Hunk[], side: 'LEFT' | 'RIGHT', line: number, oldPath: string, newPath: string): PlacedLine {
  let shift = 0 // new line minus old line, past the hunks before `line`
  for (const h of hunks) {
    if (side === 'RIGHT') {
      if (h.newCount > 0 && line >= h.newStart && line < h.newStart + h.newCount) {
        // Added: the old line after it is the one after the hunk's removed lines.
        const oldPos = h.oldCount > 0 ? h.oldStart + h.oldCount : h.oldStart + 1
        return { oldPath, newPath, oldLine: null, newLine: line, oldPos, newPos: line }
      }
      if (h.newCount > 0 ? h.newStart + h.newCount <= line : h.newStart < line) shift += h.newCount - h.oldCount
    } else {
      if (h.oldCount > 0 && line >= h.oldStart && line < h.oldStart + h.oldCount) {
        const newPos = h.newCount > 0 ? h.newStart : h.newStart + 1
        return { oldPath, newPath, oldLine: line, newLine: null, oldPos: line, newPos }
      }
      if (h.oldCount > 0 ? h.oldStart + h.oldCount <= line : h.oldStart < line) shift += h.newCount - h.oldCount
    }
  }
  const oldLine = side === 'LEFT' ? line : line - shift
  const newLine = side === 'RIGHT' ? line : line + shift
  return { oldPath, newPath, oldLine, newLine, oldPos: oldLine, newPos: newLine }
}

const SHA = /^[0-9a-f]{40}$/i

/** The lines of `path` (its path in head) between two commits the repository has. */
export async function fileLines(ctx: GitContext, repo: string, base: string, head: string, path: string): Promise<FileLines> {
  if (!SHA.test(base) || !SHA.test(head)) throw invalid('Invalid commit')
  const renames = await ctx.git(repo, ['diff', '--no-color', '--no-ext-diff', '-M', '--name-status', '-z', '--diff-filter=R', base, head], { allowFailure: true })
  const oldPath = parseNameStatusZ(renames.stdout).find((e) => e.path === path)?.oldPath ?? path
  const paths = oldPath === path ? [path] : [oldPath, path]
  const diff = await ctx.git(repo, ['diff', '--no-color', '--no-ext-diff', '-M', '-U0', base, head, '--', ...paths], { allowFailure: true, env: LITERAL_PATHSPECS })
  if (diff.code !== 0) throw invalid('The repository does not have the pull request’s commits. Refresh the review and try again.')
  const hunks = hunksOf(diff.stdout)
  return { oldPath, newPath: path, at: (side, line) => placeLine(hunks, side, line, oldPath, path) }
}

/** The merge base of two commits the repository has. */
export async function mergeBase(ctx: GitContext, repo: string, a: string, b: string): Promise<string> {
  if (!SHA.test(a) || !SHA.test(b)) throw invalid('Invalid commit')
  const res = await ctx.git(repo, ['merge-base', a, b], { allowFailure: true })
  const base = res.stdout.trim()
  if (res.code !== 0 || !SHA.test(base)) throw invalid('The repository does not have the pull request’s commits. Refresh the review and try again.')
  return base
}

/** Largest file whose lines are read for their length. */
const MAX_BLOB = 8 * 1024 * 1024

/** How many characters line `line` of `path` has at `commit` (0 when it cannot be read). */
export async function lineLength(ctx: GitContext, repo: string, commit: string, path: string, line: number): Promise<number> {
  if (!SHA.test(commit) || !path || path.startsWith('-') || !Number.isSafeInteger(line) || line < 1) return 0
  const res = await ctx.git(repo, ['cat-file', 'blob', `${commit}:${path}`], { allowFailure: true, maxBuffer: MAX_BLOB })
  return res.code === 0 ? (res.stdout.split('\n')[line - 1] ?? '').replace(/\r$/, '').length : 0
}

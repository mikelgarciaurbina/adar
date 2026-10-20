// Edit the message of an existing commit in place (GitKraken's "Edit commit message").
//
// Nothing is checked out, stashed or replayed: the edited commit and every commit after it up to HEAD are
// recreated with the same trees, authors and parent shape (merges included), then HEAD moves in a single
// compare-and-swap `update-ref`. The index, the working tree and untracked or ignored files are never
// touched, no checkout hooks run, and the operation cannot stop halfway: until HEAD moves, the only trace is
// a few unreachable objects.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RewordInfo, RewordResult } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { arg, combinedOutput, failure, gitAtLeast, invalid, isUnborn, resolveCommit } from './util'

type RewordOps = Pick<WriteOps, 'getRewordInfo' | 'rewordCommit'>

/** A commit to recreate and its parents as git shows them (shallow grafts applied). */
interface ChainLink {
  sha: string
  parents: string[]
}

interface Plan {
  head: string
  /** The edited commit first, then its descendants up to HEAD, parents always before children. */
  chain: ChainLink[]
}

async function isAncestorOfHead(ctx: GitContext, repo: string, sha: string): Promise<boolean> {
  const res = await ctx.git(repo, ['merge-base', '--is-ancestor', sha, 'HEAD'], { allowFailure: true })
  return res.code === 0
}

/** Full message as UTF-8 (git converts commits stored in another encoding), trailing newlines removed. */
async function fullMessage(ctx: GitContext, repo: string, sha: string): Promise<string> {
  const res = await ctx.git(repo, ['log', '-1', '--no-show-signature', '--encoding=UTF-8', '--format=%B', sha, '--'])
  return res.stdout.replace(/\n+$/, '')
}

function parseChain(stdout: string): ChainLink[] {
  return stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(([sha]) => !!sha)
    .map(([sha, ...parents]) => ({ sha, parents }))
}

/** Commits whose parents a shallow clone did not download (recreating them would cut history off). */
async function shallowBoundaries(ctx: GitContext, repo: string): Promise<Set<string>> {
  const shallow = await ctx.git(repo, ['rev-parse', '--is-shallow-repository'], { allowFailure: true })
  if (shallow.stdout.trim() !== 'true') return new Set()
  const rel = (await ctx.git(repo, ['rev-parse', '--git-path', 'shallow'])).stdout.trim()
  const text = await fs.readFile(path.resolve(repo, rel), 'utf8').catch(() => '')
  return new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))
}

const SHALLOW_REASON =
  'This history comes from a shallow clone and the commits before it were not downloaded. Fetch the full history first (git fetch --unshallow).'

/** Why the commit cannot be edited (or null), and what an edit would recreate. */
async function check(ctx: GitContext, repo: string, sha: string): Promise<{ reason: string | null; isHead: boolean; plan: Plan | null }> {
  const refuse = (reason: string) => ({ reason, isHead: false, plan: null })
  if (await isUnborn(ctx, repo)) return refuse('This repository has no commits yet')
  const state = await ctx.operationState(repo)
  if (state !== 'none') return refuse(`Finish or abort the ${state} in progress first`)
  const head = await resolveCommit(ctx, repo, 'HEAD')
  const isHead = sha === head
  if (!isHead && !(await isAncestorOfHead(ctx, repo, sha))) {
    return refuse('Only commits on the checked-out branch can be edited. Check out a branch that contains it first.')
  }
  const own = await ctx.git(repo, ['rev-list', '--parents', '-n', '1', sha, '--'])
  const later = isHead
    ? null
    : await ctx.git(repo, ['rev-list', '--topo-order', '--reverse', '--parents', '--ancestry-path', `${sha}..HEAD`, '--'])
  const chain = [...parseChain(own.stdout), ...parseChain(later?.stdout ?? '')]
  const boundaries = await shallowBoundaries(ctx, repo)
  if (chain.some((c) => boundaries.has(c.sha))) return refuse(SHALLOW_REASON)
  return { reason: null, isHead, plan: { head, chain } }
}

/** Branches and tags that contain the commit, split by what an edit means for them. */
async function refsContaining(
  ctx: GitContext,
  repo: string,
  sha: string
): Promise<Pick<RewordInfo, 'branch' | 'upstream' | 'localBranches' | 'remoteBranches' | 'tags'>> {
  const head = (await ctx.git(repo, ['symbolic-ref', '-q', 'HEAD'], { allowFailure: true })).stdout.trim() || null
  const up = head ? await ctx.git(repo, ['rev-parse', '--symbolic-full-name', '@{upstream}'], { allowFailure: true }) : null
  const upstreamRef = up?.code === 0 ? up.stdout.trim() || null : null
  const out = {
    branch: head?.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : null,
    upstream: null as string | null,
    localBranches: [] as string[],
    remoteBranches: [] as string[],
    tags: [] as string[]
  }
  const res = await ctx.git(
    repo,
    ['for-each-ref', '--contains', sha, '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'],
    { allowFailure: true }
  )
  for (const line of res.code === 0 ? res.stdout.split('\n') : []) {
    const [ref, symref] = line.split('\0')
    if (!ref || symref || ref === head) continue // skip origin/HEAD-style symbolic refs and the branch itself
    if (ref === upstreamRef && ref.startsWith('refs/remotes/')) out.upstream = ref.slice('refs/remotes/'.length)
    else if (ref.startsWith('refs/heads/')) out.localBranches.push(ref.slice('refs/heads/'.length))
    else if (ref.startsWith('refs/remotes/')) out.remoteBranches.push(ref.slice('refs/remotes/'.length))
    else if (ref.startsWith('refs/tags/')) out.tags.push(ref.slice('refs/tags/'.length))
  }
  return out
}

/** `git commit --cleanup=whitespace`: trailing spaces and surplus blank lines removed, one final newline. */
async function cleanMessage(ctx: GitContext, repo: string, message: string): Promise<string> {
  const res = await ctx.git(repo, ['stripspace'], { input: message })
  if (!res.stdout.trim()) throw invalid('The commit message cannot be empty')
  return res.stdout
}

/** Run the repository's commit-msg hook on the message (it may reject or amend it, e.g. add a Change-Id). */
async function applyCommitMsgHook(ctx: GitContext, repo: string, message: string): Promise<string> {
  if (!(await gitAtLeast(ctx, 2, 36))) return message // `git hook run` is newer than that
  const dir = await fs.mkdtemp(path.join(await ctx.ensureTmpDir(), 'reword-'))
  const file = path.join(dir, 'COMMIT_EDITMSG')
  try {
    await fs.writeFile(file, message, 'utf8')
    const res = await ctx.git(repo, ['hook', 'run', '--ignore-missing', 'commit-msg', '--', file], {
      allowFailure: true,
      timeoutMs: 300_000
    })
    if (res.code !== 0) {
      const output = combinedOutput(res).trim().slice(0, 2000)
      throw invalid(`The commit-msg hook rejected the message${output ? `:\n${output}` : ''}`)
    }
    return cleanMessage(ctx, repo, await fs.readFile(file, 'utf8'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ── Recreating commits ─────────────────────────────────────────────────────

interface RawHeader {
  key: string
  /** The whole header entry (first line plus continuation lines), without the final newline. */
  bytes: Buffer
}

interface RawCommit {
  headers: RawHeader[]
  tree: string
  parents: string[]
  /** Value of the author header (bytes after "author "). */
  author: Buffer
  encoding: string | null
  message: Buffer
}

const NL = Buffer.from('\n')

/** Raw objects of `shas` in one `cat-file --batch` call. */
async function readCommits(ctx: GitContext, repo: string, shas: string[]): Promise<Map<string, RawCommit>> {
  const res = await ctx.git(repo, ['cat-file', '--batch'], { input: shas.map((s) => `${s}\n`).join(''), binary: true })
  const buf = res.stdoutBuffer ?? Buffer.alloc(0)
  const out = new Map<string, RawCommit>()
  let i = 0
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i)
    const header = buf.toString('latin1', i, nl < 0 ? buf.length : nl)
    const m = /^([0-9a-f]+) commit (\d+)$/.exec(header)
    if (nl < 0 || !m) throw invalid(`Could not read commit ${header.split(' ')[0]}`)
    const size = Number(m[2])
    out.set(m[1], parseCommit(buf.subarray(nl + 1, nl + 1 + size)))
    i = nl + 1 + size + 1
  }
  return out
}

function parseCommit(buf: Buffer): RawCommit {
  const sep = buf.indexOf('\n\n')
  const end = sep < 0 ? buf.length : sep
  const commit: RawCommit = { headers: [], tree: '', parents: [], author: Buffer.alloc(0), encoding: null, message: sep < 0 ? Buffer.alloc(0) : buf.subarray(sep + 2) }
  let i = 0
  while (i < end) {
    let nl = buf.indexOf(0x0a, i)
    if (nl < 0 || nl > end) nl = end
    const line = buf.subarray(i, nl)
    i = nl + 1
    const last = commit.headers[commit.headers.length - 1]
    if (line[0] === 0x20 && last) {
      // Continuation of a multi-line header (gpgsig, mergetag).
      last.bytes = Buffer.concat([last.bytes, NL, line])
      continue
    }
    const sp = line.indexOf(0x20)
    const key = line.toString('latin1', 0, sp < 0 ? line.length : sp)
    const value = sp < 0 ? Buffer.alloc(0) : line.subarray(sp + 1)
    commit.headers.push({ key, bytes: line })
    if (key === 'tree') commit.tree = value.toString('latin1')
    else if (key === 'parent') commit.parents.push(value.toString('latin1'))
    else if (key === 'author') commit.author = value
    else if (key === 'encoding') commit.encoding = value.toString('latin1').trim()
  }
  return commit
}

const isUtf8 = (encoding: string | null) => !encoding || /^utf-?8$/i.test(encoding)

/** Strict decoding: never replace bytes we cannot read (that would silently change names or messages). */
function decode(bytes: Buffer, encoding: string | null, sha: string): string {
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(isUtf8(encoding) ? 'utf-8' : encoding!, { fatal: true })
  } catch {
    throw invalid(`Commit ${sha.slice(0, 7)} uses the ${encoding} text encoding, which Adar cannot convert. Edit it with git in a terminal.`)
  }
  try {
    return decoder.decode(bytes)
  } catch {
    throw invalid(`Commit ${sha.slice(0, 7)} contains text that is not valid ${encoding ?? 'UTF-8'}, so it cannot be recreated safely.`)
  }
}

/**
 * The commit with new parents and committer, gpgsig dropped (the content changed) and everything else
 * byte for byte: author, encoding, mergetag and other headers, message. For the edited commit, `message`
 * replaces the message; it is UTF-8, so a commit stored in another encoding has its author converted too.
 */
function rebuild(commit: RawCommit, sha: string, parents: string[], committer: string, message?: string): Buffer {
  const convert = message !== undefined && !isUtf8(commit.encoding)
  const lines: Buffer[] = []
  for (const h of commit.headers) {
    if (h.key === 'parent' || h.key === 'gpgsig' || h.key === 'gpgsig-sha256') continue
    if (h.key === 'committer') lines.push(Buffer.from(`committer ${committer}`, 'utf8'))
    else if (h.key === 'encoding' && convert) continue
    else if (h.key === 'author' && convert) lines.push(Buffer.from(`author ${decode(commit.author, commit.encoding, sha)}`, 'utf8'))
    else lines.push(h.bytes)
    if (h.key === 'tree') for (const p of parents) lines.push(Buffer.from(`parent ${p}`, 'latin1'))
  }
  const body = message !== undefined ? Buffer.from(message, 'utf8') : commit.message
  return Buffer.concat([...lines.flatMap((l) => [l, NL]), NL, body])
}

/** Author name, email and date of a raw author value (`Name <email> 1700000000 +0200`). */
function splitAuthor(v: Buffer, encoding: string | null, sha: string): { name: string; email: string; date: string } {
  const lt = v.indexOf(0x3c)
  const gt = lt < 0 ? -1 : v.indexOf(0x3e, lt)
  const date = gt < 0 ? '' : v.toString('latin1', gt + 1).trim()
  if (lt < 0 || gt < 0 || !/^\d+ [+-]\d{4}$/.test(date)) throw invalid(`Commit ${sha.slice(0, 7)} has an author line git cannot reuse`)
  const name = v.subarray(0, lt > 0 && v[lt - 1] === 0x20 ? lt - 1 : lt) // only the separator space
  return { name: decode(name, encoding, sha), email: decode(v.subarray(lt + 1, gt), encoding, sha), date }
}

/**
 * Signed variant: `commit-tree -S` (the only way to get git to sign), which takes the author from the
 * environment. git tidies an author it is given that way, so refuse instead of silently changing one
 * that it would not reproduce. Extra headers (mergetag…) cannot be passed and are dropped, like a signed rebase.
 */
async function signedCommit(ctx: GitContext, repo: string, commit: RawCommit, sha: string, parents: string[], message?: string): Promise<string> {
  const author = splitAuthor(commit.author, commit.encoding, sha)
  const cannotSign = () =>
    invalid(`Commit ${sha.slice(0, 7)} has an unusual author ("${author.name} <${author.email}>") that git would change when signing it. Edit this message with git in a terminal, or turn off commit.gpgSign for it.`)
  if (!author.name.trim()) throw cannotSign()
  const text = message !== undefined ? Buffer.from(message, 'utf8') : isUtf8(commit.encoding) ? commit.message : Buffer.from(decode(commit.message, commit.encoding, sha), 'utf8')
  const args = ['-c', 'i18n.commitEncoding=UTF-8', 'commit-tree', commit.tree]
  for (const p of parents) args.push('-p', p)
  args.push('-S', '-F', '-')
  const env = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: `@${author.date}` }
  const res = await ctx.git(repo, args, { input: text, env, timeoutMs: 600_000 })
  const created = res.stdout.trim()
  const check = await readCommits(ctx, repo, [created])
  const written = check.get(created)
  if (!written || decode(written.author, null, created) !== `${author.name} <${author.email}> ${author.date}`) throw cannotSign()
  return created
}

/**
 * Recreate the chain with `message` on its first commit; returns the new sha of every recreated commit.
 * Unsigned commits are written directly (`hash-object --literally`: some old histories have author lines
 * that today's fsck would reject, and they must be copied as they are).
 */
async function recreate(ctx: GitContext, repo: string, chain: ChainLink[], message: string): Promise<Map<string, string>> {
  const raw = await readCommits(ctx, repo, chain.map((c) => c.sha))
  const sign = (await ctx.git(repo, ['config', '--bool', '--get', 'commit.gpgSign'], { allowFailure: true })).stdout.trim() === 'true'
  // Fails with git's own "please tell me who you are" when no identity is configured.
  const committer = sign ? '' : (await ctx.git(repo, ['var', 'GIT_COMMITTER_IDENT'])).stdout.trim()
  const rewritten = new Map<string, string>()
  for (const [i, link] of chain.entries()) {
    const commit = raw.get(link.sha)
    if (!commit) throw invalid(`Could not read commit ${link.sha.slice(0, 7)}`)
    // Grafted parents (shallow clone, info/grafts) differ from the real ones: recreating would rewrite history.
    if (commit.parents.length !== link.parents.length) throw invalid(SHALLOW_REASON)
    const parents = link.parents.map((p) => rewritten.get(p) ?? p)
    const text = i === 0 ? message : undefined
    let sha: string
    if (sign) sha = await signedCommit(ctx, repo, commit, link.sha, parents, text)
    else {
      const body = rebuild(commit, link.sha, parents, committer, text)
      sha = (await ctx.git(repo, ['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'], { input: body })).stdout.trim()
    }
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw invalid('git did not return the new commit')
    rewritten.set(link.sha, sha)
  }
  return rewritten
}

export function createRewordOps(ctx: GitContext): RewordOps {
  return {
    async getRewordInfo(repo, shaArg) {
      const sha = await resolveCommit(ctx, repo, arg(shaArg, 'commit'))
      const { reason, isHead, plan } = await check(ctx, repo, sha)
      const info: RewordInfo = {
        editable: reason === null,
        reason,
        isHead,
        message: await fullMessage(ctx, repo, sha),
        rewritten: plan?.chain.length ?? 0,
        ...(await refsContaining(ctx, repo, sha))
      }
      return info
    },

    async rewordCommit(repo, shaArg, message) {
      if (typeof message !== 'string' || !message.trim()) throw invalid('The commit message cannot be empty')
      const rev = arg(shaArg, 'commit')
      return ctx.exclusive(repo, async (): Promise<RewordResult> => {
        const sha = await resolveCommit(ctx, repo, rev)
        const { reason, plan } = await check(ctx, repo, sha)
        if (reason || !plan) throw invalid(reason ?? 'This commit cannot be edited')
        const previousHead = plan.head
        const current = await fullMessage(ctx, repo, sha)
        const unchanged = (m: string) => m.replace(/\n+$/, '') === current
        let next = await cleanMessage(ctx, repo, message)
        if (!unchanged(next)) next = await applyCommitMsgHook(ctx, repo, next)
        if (unchanged(next)) {
          return { ok: true, conflicts: [], message: 'The message did not change', state: 'none', newSha: sha, previousHead }
        }

        const rewritten = await recreate(ctx, repo, plan.chain, next)
        const newHead = rewritten.get(previousHead)
        const newSha = rewritten.get(sha)
        if (!newHead || !newSha) throw invalid('This commit cannot be edited from here')
        // Compare-and-swap: refuses if anything outside Adar moved HEAD meanwhile (nothing has changed then).
        const moved = await ctx.git(repo, ['update-ref', '-m', `adar: edit message of ${sha.slice(0, 7)}`, 'HEAD', newHead, previousHead], {
          allowFailure: true
        })
        if (moved.code !== 0) {
          const now = (await ctx.git(repo, ['rev-parse', '-q', '--verify', 'HEAD'], { allowFailure: true })).stdout.trim()
          if (now !== previousHead) throw invalid('HEAD changed while the message was being edited. Nothing was changed; try again.')
          throw failure(['update-ref', 'HEAD'], moved)
        }
        return { ok: true, conflicts: [], message: 'Commit message updated', state: 'none', newSha, previousHead }
      })
    }
  }
}

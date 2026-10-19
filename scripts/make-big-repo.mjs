// Generates a large synthetic repository for performance testing (graph, log paging, refs).
//   node scripts/make-big-repo.mjs <target-dir> [commits=20000] [branches=40]
// Uses `git fast-import`, so 20k commits take a few seconds.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const [target, commitsArg = '20000', branchesArg = '40'] = process.argv.slice(2)
if (!target) {
  console.error('usage: node scripts/make-big-repo.mjs <target-dir> [commits] [branches]')
  process.exit(1)
}
const N = Number(commitsArg)
const B = Number(branchesArg)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
spawnSync('git', ['init', '-q', '-b', 'main', target], { env, stdio: 'inherit' })

const authors = ['Ana García <ana@example.com>', 'Luis Pérez <luis@example.com>', 'Marta Ruiz <marta@example.com>', 'Jon Etxeberria <jon@example.com>', 'Ane Zubiri <ane@example.com>']
let out = ''
let mark = 0
let t = 1600000000
const tips = new Map() // branch → mark
const commit = (branch, parents, msg, file) => {
  mark++
  t += 60 + (mark % 7) * 30
  const a = authors[mark % authors.length]
  const data = `${msg}\n`
  out += `commit refs/heads/${branch}\nmark :${mark}\nauthor ${a} ${t} +0200\ncommitter ${a} ${t} +0200\ndata ${Buffer.byteLength(data)}\n${data}`
  if (parents[0]) out += `from :${parents[0]}\n`
  for (const p of parents.slice(1)) out += `merge :${p}\n`
  const content = `line ${mark}\n`
  out += `M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}\n`
  tips.set(branch, mark)
  return mark
}

let main = commit('main', [], 'Initial commit', 'README.md')
for (let i = 1; i < N; i++) {
  const r = i % 10
  if (r < 6 || tips.size > B) {
    main = commit('main', [main], `Commit ${i} on main`, `src/file${i % 200}.ts`)
  } else {
    const name = `feature/topic-${i % B}`
    const base = tips.get(name) ?? main
    const m = commit(name, [base], `Work ${i} on ${name}`, `src/${name.replace('/', '-')}.ts`)
    if (i % 37 === 0) {
      main = commit('main', [main, m], `Merge branch '${name}'`, `merges/${i}.txt`)
    }
  }
}
const res = spawnSync('git', ['fast-import', '--quiet'], { cwd: target, env, input: out, maxBuffer: 1 << 30 })
if (res.status !== 0) {
  console.error(res.stderr.toString())
  process.exit(1)
}
spawnSync('git', ['checkout', '-q', 'main'], { cwd: target, env })
for (let i = 0; i < 30; i++) spawnSync('git', ['tag', `v0.${i}.0`, `main~${i * 50}`], { cwd: target, env })
console.log(`Big repo ready: ${target} (${N} commits, ${tips.size} branches)`)

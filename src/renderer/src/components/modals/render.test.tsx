// Smoke tests: server-render every modal with realistic store state. The shared
// Modal renders through a portal (needs a DOM), so it is replaced by a plain wrapper.

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, type AppState } from '@renderer/store/appStore'
import { DEFAULT_SETTINGS, type RepoInfo } from '@shared/types'

vi.mock('@renderer/components/common/Modal', () => ({
  Modal: ({ title, children, footer, className }: { title: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) => (
    <div className={`ui-modal ${className ?? ''}`}>
      <div className="ui-modal-title">{title}</div>
      {children}
      <div className="ui-modal-footer">{footer}</div>
    </div>
  )
}))

const { ModalHost } = await import('./ModalHost')
const { CredentialDialog } = await import('./CredentialDialog')
const { useUpdates } = await import('@renderer/components/update/updateStore')
const { ReleaseNotes } = await import('@renderer/components/update/ReleaseNotes')

function seedUpdates(patch: Partial<ReturnType<typeof useUpdates.getState>>) {
  useUpdates.setState(patch)
  Object.assign(useUpdates.getInitialState(), patch)
}

const releaseInfo = {
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  releaseName: 'Adar 0.2.0',
  notes: '',
  releaseUrl: 'https://github.com/mikelgarciaurbina/adar/releases/tag/v0.2.0',
  publishedAt: '',
  zip: { name: 'Adar-0.2.0-arm64.zip', url: 'https://github.com/mikelgarciaurbina/adar/releases/download/v0.2.0/Adar-0.2.0-arm64.zip', size: 1 },
  dmg: null
}

function seed(patch: Partial<AppState>) {
  useApp.setState(patch)
  Object.assign(useApp.getInitialState(), patch)
}

const repo = '/Users/me/Projects/adar'
const info: RepoInfo = {
  path: repo,
  name: 'adar',
  gitDir: `${repo}/.git`,
  isBare: false,
  head: { sha: 'a'.repeat(40), branch: 'main', detached: false, unborn: false },
  state: 'none',
  remotes: [
    { name: 'origin', fetchUrl: 'git@github.com:org/adar.git', pushUrl: 'git@github.com:org/adar.git' },
    { name: 'mirror', fetchUrl: 'https://git.example.com/adar.git', pushUrl: 'ssh://git@git.example.com/adar.git' }
  ]
}

beforeEach(() => {
  seed({
    appInfo: { version: '0.1.0', platform: 'darwin', gitVersion: 'git version 2.47.1', homeDir: '/Users/me', isElectron: true },
    settings: { ...DEFAULT_SETTINGS },
    recent: [{ path: repo, name: 'adar', lastOpened: Date.now() }],
    tabs: [{ ...(useApp.getState().tabs[0] ?? {}), path: repo, name: 'adar', info } as AppState['tabs'][number]],
    activePath: repo,
    modal: null,
    credentialQueue: []
  })
  seedUpdates({ status: null, dismissed: null, notesOpen: false })
})

const render = (modal: AppState['modal']) => {
  seed({ modal })
  return renderToStaticMarkup(<ModalHost />)
}

describe('ModalHost', () => {
  it('renders nothing without a modal', () => {
    expect(render(null)).toBe('')
  })

  it('renders the clone modal with a derived folder name and the private-repo note', () => {
    const html = render({ kind: 'clone', url: 'git@github.com:org/private-repo.git' })
    expect(html).toContain('Clone a repository')
    expect(html).toContain('value="private-repo"')
    expect(html).toContain('value="/Users/me/Projects"')
    expect(html).toContain('Private repositories work too')
    expect(html).toContain('SSH')
  })

  it('renders init, open and about', () => {
    expect(render({ kind: 'init' })).toContain('value="main"')
    expect(render({ kind: 'open' })).toContain('Repository folder')
    const about = render({ kind: 'about' })
    expect(about).toContain('not affiliated with GitKraken/Axosoft')
    expect(about).toContain('2.47.1')
  })

  it('shows the open-source repository, license and an update check in about', () => {
    const about = render({ kind: 'about' })
    expect(about).toContain('href="https://github.com/mikelgarciaurbina/adar"')
    expect(about).toContain('github.com/mikelgarciaurbina/adar<')
    expect(about).toContain('MIT License')
    expect(about).toContain('Check for Updates…')
  })

  it("renders What's new: the running version and its notes, without the Install section", () => {
    const html = render({ kind: 'whats-new', from: '0.0.9' })
    expect(html).toContain('Adar 0.1.0')
    expect(html).toContain('Updated from 0.0.9')
    expect(html).toContain('<h4>')
    expect(html).not.toContain('<h4>Install</h4>')
    expect(html).toContain('All releases')
    expect(render({ kind: 'whats-new', from: '' })).toContain('Just updated')
    expect(render({ kind: 'whats-new' })).toContain('The version you are running')
  })

  it('renders release notes like GitHub: a wrapped bullet stays one item, with bold, italic and code', () => {
    const md = '### New\n- **Menu bar.** Antlers in the\n  menu bar, see *Settings*.\nlazy line\n- Two\n\nA paragraph with `code`\nand a * star.'
    expect(renderToStaticMarkup(<ReleaseNotes markdown={md} />)).toBe(
      '<div class="up-notes selectable"><h4>New</h4><ul><li><strong>Menu bar.</strong> Antlers in the menu bar, see <em>Settings</em>. lazy line</li>' +
        '<li>Two</li></ul><p>A paragraph with <code>code</code> and a * star.</p></div>'
    )
  })

  it('explains ~ expansion, offers Browse… and submits on Enter in the open modal', () => {
    const html = render({ kind: 'open' })
    expect(html).toContain('Browse…')
    expect(html).toContain('<code>~</code> is your home folder (<code>/Users/me</code>)')
    expect(html).toContain('placeholder="~/path/to/repository"')
    expect(html).toMatch(/<form[^>]*>[\s\S]*<button type="submit" hidden="">/) // Enter submits the form
  })

  it('renders every settings section entry and the general controls', () => {
    const html = render({ kind: 'settings' })
    for (const s of ['General', 'Graph', 'Diff', 'Integrations', 'Git']) expect(html).toContain(`>${s}<`)
    expect(html).toContain('Auto-fetch')
    expect(html).toContain('Every 5 minutes')
    expect(render({ kind: 'settings', section: 'integrations' })).toContain('Ghostty')
    expect(render({ kind: 'settings', section: 'graph' })).toContain('Commits per page')
    const diff = render({ kind: 'settings', section: 'diff' })
    expect(diff).toContain('Context lines')
    expect(diff).toContain('>Unified<')
    expect(diff).toContain('>Split<')
    expect(diff).not.toContain('>Hunk<')
    expect(diff).toContain('Show full file by default')
    expect(diff).toContain('aria-label="Show full file by default"')
  })

  it('renders the update controls in Settings → General', () => {
    const html = render({ kind: 'settings' })
    expect(html).toContain('Check for updates automatically')
    expect(html).toMatch(/aria-checked="true" aria-label="Check for updates automatically"/)
    expect(html).toContain('Adar 0.1.0')
    expect(html).toContain('Check now')
    expect(html).not.toContain('Skipped version')
    expect(html).not.toContain('is available')
  })

  it('offers the available update and the skipped version reset in settings', () => {
    seedUpdates({ status: { state: 'available', currentVersion: '0.1.0', info: releaseInfo, canInstall: false } })
    seed({ settings: { ...DEFAULT_SETTINGS, checkForUpdates: false, skippedUpdateVersion: '0.1.5' } })
    const html = render({ kind: 'settings' })
    expect(html).toContain('Adar 0.2.0 is available')
    expect(html).toContain('>Update<')
    expect(html).toContain('What&#x27;s new')
    expect(html).toMatch(/aria-checked="false" aria-label="Check for updates automatically"/)
    expect(html).toContain('Skipped version 0.1.5')
    expect(html).toContain('>Reset<')
  })

  it('offers a download from the release page when the release has nothing to install in place (Windows, Linux)', () => {
    seedUpdates({ status: { state: 'available', currentVersion: '0.1.0', info: { ...releaseInfo, zip: null }, canInstall: false } })
    seed({ settings: DEFAULT_SETTINGS })
    const html = render({ kind: 'settings' })
    expect(html).toContain('Adar 0.2.0 is available')
    expect(html).toContain('>Download<')
    expect(html).not.toContain('>Update<')
  })

  it('reflects diff settings in the controls', () => {
    seed({ settings: { ...DEFAULT_SETTINGS, diffViewMode: 'split', diffFullFile: true } })
    const diff = render({ kind: 'settings', section: 'diff' })
    expect(diff).toMatch(/aria-checked="true"[^>]*>Split</)
    expect(diff).toMatch(/aria-checked="true" aria-label="Show full file by default"/)
  })

  it('lists recent repositories that are not open in the open modal, with hints for equal names', () => {
    seed({
      recent: [
        { path: repo, name: 'adar', lastOpened: 3 },
        { path: '/Users/me/a/demo', name: 'demo', lastOpened: 2 },
        { path: '/Users/me/b/demo', name: 'demo', lastOpened: 1 }
      ]
    })
    const html = render({ kind: 'open' })
    expect(html).not.toContain('title="/Users/me/Projects/adar"') // already open as a tab
    expect(html).toContain('md-quick-hint">a<')
    expect(html).toContain('md-quick-hint">b<')
  })

  it('renders identity (loading) and remotes', () => {
    expect(render({ kind: 'identity', repo: null })).toContain('Reading git config')
    const remotes = render({ kind: 'remotes', repo })
    expect(remotes).toContain('git@github.com:org/adar.git')
    expect(remotes).toContain('GitHub')
    expect(remotes).toContain('ssh://git@git.example.com/adar.git') // separate push URL
  })
})

describe('CredentialDialog', () => {
  it('renders nothing when the queue is empty', () => {
    expect(renderToStaticMarkup(<CredentialDialog />)).toBe('')
  })

  it('renders a password prompt with a token hint', () => {
    seed({ credentialQueue: [{ id: 'c1', prompt: "Password for 'https://me@github.com':", kind: 'password', secret: true }] })
    const html = renderToStaticMarkup(<CredentialDialog />)
    expect(html).toContain('Password for github.com')
    expect(html).toContain('type="password"')
    expect(html).toContain('personal access token')
  })

  it('shows an SSH keyboard-interactive prompt as the server\'s words, without a spoofed GitHub target', () => {
    seed({
      credentialQueue: [{ id: 'c4', prompt: "(git@gitlab-mirror.evil.example) Password for 'https://github.com':", kind: 'password', secret: true }]
    })
    const html = renderToStaticMarkup(<CredentialDialog />)
    expect(html).toContain('Prompt from SSH server gitlab-mirror.evil.example')
    expect(html).toContain('The server says:')
    expect(html).toContain('never enter a password or token for another service')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('Password for github.com')
    expect(html).not.toContain('personal access token')
    expect(html).not.toMatch(/md-cred-host">github\.com/)
  })

  it('renders yes/no buttons for host verification', () => {
    seed({
      credentialQueue: [
        { id: 'c2', prompt: 'The authenticity of host ... Are you sure you want to continue connecting (yes/no/[fingerprint])?', kind: 'yesno', secret: false },
        { id: 'c3', prompt: 'x', kind: 'other', secret: false }
      ]
    })
    const html = renderToStaticMarkup(<CredentialDialog />)
    expect(html).toContain('Verify SSH host')
    expect(html).toContain('>Yes<')
    expect(html).toContain('>No<')
    expect(html).toContain('1 more request waiting')
  })
})

// Preferences. Every control applies immediately through store.updateSettings
// (persisted, debounced, by the store). The Git section edits the global identity.

import { useEffect, useId, useRef, useState } from 'react'
import { Download, FileDiff, GitBranch, GitGraph, Plug, RefreshCw, Settings, SlidersHorizontal } from 'lucide-react'
import { api, cli, isElectron } from '@renderer/api/client'
import { installCliCommand, uninstallCliCommand } from '@renderer/actions/cli'
import type { CliStatus } from '@shared/cli'
import { Button, Spinner } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { formatGitVersion } from '@renderer/components/layout/chrome'
import { checkForUpdatesNow, installUpdate, startUpdate } from '@renderer/components/update/UpdateNotice'
import { useUpdates } from '@renderer/components/update/updateStore'
import { useApp, useSettings } from '@renderer/store/appStore'
import type { AppSettings, DiffViewMode, Identity, PullMode, ThemeSetting } from '@shared/types'
import { closeIfTopmost, Segmented, Select, SettingGroup, SettingRow, Switch } from './controls'
import { validateIdentity } from './identity'
import { describeUpdateStatus, type UpdateAction } from './updates'

type SectionId = 'general' | 'graph' | 'diff' | 'integrations' | 'git'

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={15} /> },
  { id: 'graph', label: 'Graph', icon: <GitGraph size={15} /> },
  { id: 'diff', label: 'Diff', icon: <FileDiff size={15} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={15} /> },
  { id: 'git', label: 'Git', icon: <GitBranch size={15} /> }
]

function isSection(s: string | undefined): s is SectionId {
  return !!s && SECTIONS.some((x) => x.id === s)
}

const AUTO_FETCH_OPTIONS = [0, 1, 2, 5, 10, 15, 30, 60]
const PAGE_SIZES = [500, 1000, 2000, 5000, 10000]
const EDITORS = [
  { cmd: 'code', label: 'VS Code' },
  { cmd: 'cursor', label: 'Cursor' },
  { cmd: 'zed', label: 'Zed' },
  { cmd: 'subl', label: 'Sublime Text' },
  { cmd: 'idea', label: 'IntelliJ IDEA' },
  { cmd: 'webstorm', label: 'WebStorm' }
]
const TERMINALS = ['Terminal', 'iTerm', 'Warp', 'Ghostty']

function update(patch: Partial<AppSettings>) {
  void useApp.getState().updateSettings(patch)
}

/** Graph data depends on these settings: reload logs of open tabs. */
function updateGraphData(patch: Partial<AppSettings>) {
  update(patch)
  const s = useApp.getState()
  for (const t of s.tabs) void s.refresh(t.path, ['log'])
}

export function SettingsModal({ section }: { section?: string }) {
  const [active, setActive] = useState<SectionId>(isSection(section) ? section : 'general')
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]

  return (
    <Modal
      title={
        <span className="md-title">
          <Settings size={16} /> Settings
        </span>
      }
      className="md-modal md-settings"
      width={860}
      onClose={() => closeIfTopmost('md-settings')}
    >
      <div className="md-settings-layout">
        <nav className="md-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`md-settings-nav-item${active === s.id ? ' md-active' : ''}`}
              onClick={() => setActive(s.id)}
              aria-current={active === s.id ? 'page' : undefined}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="md-settings-body">
          <h2 className="md-page-title">{current.label}</h2>
          {active === 'general' && <GeneralSection />}
          {active === 'graph' && <GraphSection />}
          {active === 'diff' && <DiffSection />}
          {active === 'integrations' && <IntegrationsSection />}
          {active === 'git' && <GitSection />}
        </div>
      </div>
    </Modal>
  )
}

const THEMES: Array<{
  value: ThemeSetting
  name: string
  meaning?: string
  note: string
}> = [
  { value: 'dark', name: 'Gaua', meaning: 'night', note: 'The default' },
  {
    value: 'light',
    name: 'Eguna',
    meaning: 'day',
    note: 'Warm paper, deeper inks'
  },
  { value: 'system', name: 'System', note: 'Follows macOS' }
]

/** A tiny window in one theme: side panel, two lanes with HEAD on top, details panel. */
function ThemeMiniature({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <span className={`md-tp md-tp-${theme}`}>
      <span className="md-tp-side" />
      <span className="md-tp-graph">
        <span className="md-tp-lane md-tp-lane-1" />
        <span className="md-tp-lane md-tp-lane-2" />
        <span className="md-tp-head" />
      </span>
      <span className="md-tp-side" />
    </span>
  )
}

/** Theme cards, Basque name first (gaua = night, eguna = day), each with a miniature of the app. */
function ThemePicker({ value }: { value: ThemeSetting }) {
  return (
    <div className="md-themes" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          className={`md-theme${value === t.value ? ' md-theme-on' : ''}`}
          onClick={() => update({ theme: t.value })}
        >
          <span className="md-theme-preview" aria-hidden="true">
            {t.value === 'system' ? (
              <>
                <ThemeMiniature theme="dark" />
                <ThemeMiniature theme="light" />
              </>
            ) : (
              <ThemeMiniature theme={t.value} />
            )}
          </span>
          <span className="md-theme-name">
            {t.meaning ? (
              <>
                <span lang="eu">{t.name}</span> · {t.meaning}
              </>
            ) : (
              t.name
            )}
          </span>
          <span className="md-theme-note">{t.note}</span>
        </button>
      ))}
    </div>
  )
}

function GeneralSection() {
  const s = useSettings()
  const appInfo = useApp((st) => st.appInfo)
  const desktop = appInfo?.isElectron ?? isElectron
  const fetchId = useId()
  const pullId = useId()
  return (
    <>
      <SettingGroup title="Appearance">
        <SettingRow label="Theme" description="Gaua and Eguna are Basque for night and day." stacked>
          <ThemePicker value={s.theme} />
        </SettingRow>
        <SettingRow label="Zoom" description="Interface scale.">
          <Segmented
            ariaLabel="Zoom"
            value={String(s.zoom || 1)}
            onChange={(z) => update({ zoom: Number(z) })}
            options={[
              { value: '0.9', label: '90%' },
              { value: '1', label: '100%' },
              { value: '1.1', label: '110%' },
              { value: '1.25', label: '125%' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Dates" description="How commit dates are shown in the graph and details.">
          <Segmented
            ariaLabel="Date format"
            value={s.dateFormat}
            onChange={(dateFormat) => update({ dateFormat })}
            options={[
              { value: 'relative', label: '3 hours ago' },
              { value: 'absolute', label: 'Oct 19, 11:24' }
            ]}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Behaviour">
        <SettingRow label="Auto-fetch" description="Fetch all remotes of open repositories in the background." htmlFor={fetchId}>
          <Select id={fetchId} value={s.autoFetchMinutes} onChange={(e) => update({ autoFetchMinutes: Number(e.target.value) })}>
            {(AUTO_FETCH_OPTIONS.includes(s.autoFetchMinutes) ? AUTO_FETCH_OPTIONS : [...AUTO_FETCH_OPTIONS, s.autoFetchMinutes].sort((a, b) => a - b)).map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Off' : `Every ${m} minute${m === 1 ? '' : 's'}`}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="Default pull" description="What the Pull button does." htmlFor={pullId}>
          <Select id={pullId} value={s.defaultPullMode} onChange={(e) => update({ defaultPullMode: e.target.value as PullMode })}>
            <option value="merge">Fast-forward if possible (merge)</option>
            <option value="ff-only">Fast-forward only</option>
            <option value="rebase">Rebase</option>
          </Select>
        </SettingRow>
        <SettingRow label="Confirm dangerous actions" description="Ask before force push, hard reset and discarding changes.">
          <Switch label="Confirm dangerous actions" checked={s.confirmDangerous} onChange={(confirmDangerous) => update({ confirmDangerous })} />
        </SettingRow>
        <SettingRow label="Gravatar avatars" description="Load author pictures from gravatar.com (sends a hash of the email). Initials are used otherwise.">
          <Switch label="Gravatar avatars" checked={s.gravatar} onChange={(gravatar) => update({ gravatar })} />
        </SettingRow>
        {desktop && appInfo?.platform === 'darwin' && (
          <SettingRow label="Menu bar icon" description="The antlers in the menu bar: the active project's branch and latest commits, with Pull and Push.">
            <Switch label="Menu bar icon" checked={s.menuBarIcon} onChange={(menuBarIcon) => update({ menuBarIcon })} />
          </SettingRow>
        )}
        {desktop && (
          <SettingRow label="Notify about new commits" description="A notification when a fetch, auto-fetch included, brings new commits to the checked-out branch's upstream.">
            <Switch label="Notify about new commits" checked={s.notifyNewCommits} onChange={(notifyNewCommits) => update({ notifyNewCommits })} />
          </SettingRow>
        )}
      </SettingGroup>
      <UpdateSettings />
    </>
  )
}

function runUpdateAction(action: UpdateAction) {
  if (action === 'update' || action === 'retry') void startUpdate()
  else if (action === 'install' || action === 'open-installer') void installUpdate()
}

function UpdateSettings() {
  const s = useSettings()
  const appInfo = useApp((st) => st.appInfo)
  const status = useUpdates((u) => u.status)
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const desktop = appInfo?.isElectron ?? isElectron
  const summary = describeUpdateStatus(status, {
    isElectron: desktop,
    checking,
    automatic: s.checkForUpdates
  })
  const version = status?.currentVersion || appInfo?.version || '—'
  const hasNotes = !!status?.info && ['available', 'downloading', 'downloaded'].includes(status.state)

  const checkNow = async () => {
    setChecking(true)
    try {
      await checkForUpdatesNow()
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  return (
    <SettingGroup title="Updates">
      <SettingRow label="Check for updates automatically" description="Look for new Adar releases on GitHub in the background.">
        <Switch label="Check for updates automatically" checked={s.checkForUpdates} onChange={(checkForUpdates) => update({ checkForUpdates })} />
      </SettingRow>
      <SettingRow label={`Adar ${version}`} description={<span className={`md-update-status md-update-${summary.tone}`}>{summary.text}</span>}>
        <div className="md-update-actions">
          {hasNotes && (
            <Button size="sm" variant="ghost" onClick={() => useUpdates.getState().setNotesOpen(true)}>
              What&apos;s new
            </Button>
          )}
          {summary.action && (
            <Button
              size="sm"
              variant="primary"
              icon={summary.action === 'install' || summary.action === 'open-installer' ? <RefreshCw size={13} /> : <Download size={13} />}
              loading={summary.busy}
              onClick={() => runUpdateAction(summary.action)}
            >
              {summary.actionLabel}
            </Button>
          )}
          <Button size="sm" icon={<RefreshCw size={13} />} loading={checking} disabled={!desktop || summary.busy} onClick={() => void checkNow()}>
            Check now
          </Button>
        </div>
      </SettingRow>
      {s.skippedUpdateVersion && (
        <SettingRow label={`Skipped version ${s.skippedUpdateVersion}`} description="Adar does not notify you about this version. Manual checks still find it.">
          <Button size="sm" onClick={() => update({ skippedUpdateVersion: '' })}>
            Reset
          </Button>
        </SettingRow>
      )}
    </SettingGroup>
  )
}

function GraphSection() {
  const s = useSettings()
  const pageId = useId()
  return (
    <>
      <SettingGroup title="In the graph">
        <SettingRow label="Remote branches" description="Include remote-tracking branches (origin/…) in the graph.">
          <Switch label="Show remote branches" checked={s.graphShowRemotes} onChange={(v) => updateGraphData({ graphShowRemotes: v })} />
        </SettingRow>
        <SettingRow label="Tags" description="Show tag labels on commits.">
          <Switch label="Show tags" checked={s.graphShowTags} onChange={(v) => update({ graphShowTags: v })} />
        </SettingRow>
        <SettingRow label="Stashes" description="Show stashes as nodes in the graph.">
          <Switch label="Show stashes" checked={s.graphShowStashes} onChange={(v) => update({ graphShowStashes: v })} />
        </SettingRow>
        <SettingRow label="Columns" description="Extra columns next to the commit message.">
          <div className="md-chips" role="group" aria-label="Graph columns">
            {(['author', 'date', 'sha'] as const).map((col) => (
              <button
                key={col}
                type="button"
                aria-pressed={s.graphColumns[col]}
                className={`md-chip${s.graphColumns[col] ? ' md-chip-active' : ''}`}
                onClick={() =>
                  update({
                    graphColumns: {
                      ...s.graphColumns,
                      [col]: !s.graphColumns[col]
                    }
                  })
                }
              >
                {col === 'sha' ? 'SHA' : col[0].toUpperCase() + col.slice(1)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Performance">
        <SettingRow label="Commits per page" description="Loaded at once; more load as you scroll. Lower is faster on huge repositories." htmlFor={pageId}>
          <Select id={pageId} value={s.graphPageSize} onChange={(e) => updateGraphData({ graphPageSize: Number(e.target.value) })}>
            {(PAGE_SIZES.includes(s.graphPageSize) ? PAGE_SIZES : [...PAGE_SIZES, s.graphPageSize].sort((a, b) => a - b)).map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

function DiffSection() {
  const s = useSettings()
  const ctxId = useId()
  return (
    <>
      <SettingGroup title="Layout">
        <SettingRow label="Layout" description="Unified shows old and new lines in one column; split shows them side by side.">
          <Segmented<DiffViewMode>
            ariaLabel="Diff layout"
            value={s.diffViewMode}
            onChange={(diffViewMode) => update({ diffViewMode })}
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Split' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Show full file by default" description="Open diffs with the whole file instead of only the changed hunks. You can still switch per diff.">
          <Switch label="Show full file by default" checked={s.diffFullFile} onChange={(diffFullFile) => update({ diffFullFile })} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Changes">
        <SettingRow label="Ignore whitespace" description="Hide changes that only add or remove whitespace.">
          <Switch label="Ignore whitespace" checked={s.diffIgnoreWhitespace} onChange={(diffIgnoreWhitespace) => update({ diffIgnoreWhitespace })} />
        </SettingRow>
        <SettingRow label="Context lines" description="Unchanged lines shown around each change (0–50)." htmlFor={ctxId}>
          <input
            id={ctxId}
            type="number"
            className="ui-input md-number"
            min={0}
            max={50}
            value={s.diffContextLines}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (Number.isFinite(n)) update({ diffContextLines: Math.max(0, Math.min(50, n)) })
            }}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

function IntegrationsSection() {
  const s = useSettings()
  const platform = useApp((st) => st.appInfo?.platform)
  const editorId = useId()
  const termId = useId()
  const listId = useId()
  const terminals = TERMINALS.includes(s.terminalApp) || !s.terminalApp ? TERMINALS : [...TERMINALS, s.terminalApp]
  return (
    <>
      <SettingGroup title="Open in…">
        <SettingRow
          label="Editor"
          description="Command used by “Open in editor” (e.g. code, cursor, zed). Leave empty to use the system text editor; apps and scripts are never launched."
          htmlFor={editorId}
        >
          <div className="md-editor">
            <input
              id={editorId}
              className="ui-input ui-mono md-editor-input"
              list={listId}
              placeholder="system default"
              value={s.editorCommand}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => update({ editorCommand: e.target.value })}
            />
            <datalist id={listId}>
              {EDITORS.map((e) => (
                <option key={e.cmd} value={e.cmd}>
                  {e.label}
                </option>
              ))}
            </datalist>
            <div className="md-chips">
              {EDITORS.slice(0, 4).map((e) => (
                <button
                  key={e.cmd}
                  type="button"
                  className={`md-chip${s.editorCommand === e.cmd ? ' md-chip-active' : ''}`}
                  onClick={() => update({ editorCommand: e.cmd })}
                  title={`${e.label} (${e.cmd})`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        </SettingRow>
        <SettingRow
          label="Terminal"
          description={
            platform && platform !== 'darwin'
              ? 'Terminal application used by “Open in terminal” (macOS names; other platforms use the system terminal).'
              : 'Terminal application used by “Open in terminal”.'
          }
          htmlFor={termId}
        >
          <Select id={termId} value={s.terminalApp || 'Terminal'} onChange={(e) => update({ terminalApp: e.target.value })}>
            {terminals.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingGroup>
      {isElectron && <CliSetting />}
    </>
  )
}

/** `adar` command-line tool: status + install/uninstall. */
function CliSetting() {
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = () => void cli.cliStatus().then(setStatus, () => setStatus(null))
  useEffect(reload, [])
  if (!status?.available) return null
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      reload()
    }
  }
  const description = status.installedAt
    ? `Run "adar" in a repository folder (or "adar <path>") to open it here. Installed at ${status.installedAt}${status.onPath ? '' : ' (that folder is not on your PATH)'}.`
    : 'Adds an "adar" command to your terminal: run it in a repository folder to open it in Adar, like "code ." for VS Code.'
  return (
    <SettingGroup title="Command line">
      <SettingRow label="Command line tool" description={description}>
        {status.installedAt ? (
          <Button size="sm" onClick={() => void run(uninstallCliCommand)} loading={busy}>
            Uninstall
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void run(() => installCliCommand())} loading={busy}>
            Install “adar” command
          </Button>
        )}
      </SettingRow>
    </SettingGroup>
  )
}

function GitSection() {
  const appInfo = useApp((s) => s.appInfo)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const nameId = useId()
  const emailId = useId()

  useEffect(() => {
    let alive = true
    api.getIdentity(null).then(
      (id) => {
        if (!alive) return
        setIdentity(id)
        setName(id.name)
        setEmail(id.email)
      },
      (err) => alive && setLoadError(err instanceof Error ? err.message : String(err))
    )
    return () => {
      alive = false
    }
  }, [])

  const error = validateIdentity(name, email)
  const dirty = !!identity && (name.trim() !== identity.name || email.trim() !== identity.email)

  const save = async () => {
    if (error || saving) return
    setSaving(true)
    try {
      await api.setIdentity(null, name.trim(), email.trim())
      const fresh = await api.getIdentity(null).catch(() => ({
        name: name.trim(),
        email: email.trim(),
        scope: 'global' as const
      }))
      setIdentity(fresh)
      toast.success('Global Git identity saved')
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  const gitVersion = formatGitVersion(appInfo?.gitVersion)

  return (
    <>
      <SettingGroup title="Global identity" description="Used for commits in every repository that does not set its own identity (git config --global).">
        {loadError ? (
          <div className="md-alert md-alert-error">Could not read the Git configuration: {loadError}</div>
        ) : !identity ? (
          <div className="md-loading">
            <Spinner size="sm" /> Loading…
          </div>
        ) : (
          <form
            className="md-identity-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <SettingRow label="Name" htmlFor={nameId}>
              <input id={nameId} className="ui-input md-text" value={name} placeholder="Jane Doe" spellCheck={false} onChange={(e) => setName(e.target.value)} />
            </SettingRow>
            <SettingRow label="Email" htmlFor={emailId}>
              <input
                id={emailId}
                className="ui-input md-text"
                type="email"
                value={email}
                placeholder="jane@example.com"
                spellCheck={false}
                onChange={(e) => setEmail(e.target.value)}
              />
            </SettingRow>
            <div className="md-form-actions">
              {(dirty || !identity.name || !identity.email) && error && <small className="ui-error">{error}</small>}
              {identity.scope === 'none' && <small className="ui-hint">No identity is configured yet.</small>}
              <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirty || !!error}>
                Save identity
              </Button>
            </div>
          </form>
        )}
      </SettingGroup>
      <SettingGroup title="Git">
        <SettingRow label="Git executable" description="Adar uses the git installed on your system, with your configuration, SSH keys and credential helpers.">
          <span className="md-value">{gitVersion ? `git ${gitVersion}` : 'unknown version'}</span>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

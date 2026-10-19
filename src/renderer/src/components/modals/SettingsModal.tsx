// Preferences. Every control applies immediately through store.updateSettings
// (persisted, debounced, by the store). The Git section edits the global identity.

import { useEffect, useId, useState } from 'react'
import { FileDiff, GitBranch, GitGraph, Plug, Settings, SlidersHorizontal } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Button, Spinner } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { formatGitVersion } from '@renderer/components/layout/chrome'
import { useApp, useSettings } from '@renderer/store/appStore'
import type { AppSettings, DiffViewMode, Identity, PullMode, ThemeSetting } from '@shared/types'
import { closeIfTopmost, Segmented, SettingRow, Switch } from './controls'
import { validateIdentity } from './identity'

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

  return (
    <Modal
      title={
        <span className="md-title">
          <Settings size={16} /> Settings
        </span>
      }
      className="md-modal md-settings"
      width={780}
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

function SectionTitle({ children, description }: { children: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="md-section-head">
      <h3 className="md-section-title">{children}</h3>
      {description && <p className="md-section-desc">{description}</p>}
    </div>
  )
}

function GeneralSection() {
  const s = useSettings()
  const fetchId = useId()
  const pullId = useId()
  return (
    <>
      <SectionTitle>General</SectionTitle>
      <SettingRow label="Theme" description="Follow the system appearance or force dark / light.">
        <Segmented<ThemeSetting>
          ariaLabel="Theme"
          value={s.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' }
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
      <SettingRow label="Auto-fetch" description="Fetch all remotes of open repositories in the background." htmlFor={fetchId}>
        <select id={fetchId} className="ui-input md-select" value={s.autoFetchMinutes} onChange={(e) => update({ autoFetchMinutes: Number(e.target.value) })}>
          {(AUTO_FETCH_OPTIONS.includes(s.autoFetchMinutes) ? AUTO_FETCH_OPTIONS : [...AUTO_FETCH_OPTIONS, s.autoFetchMinutes].sort((a, b) => a - b)).map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Off' : `Every ${m} minute${m === 1 ? '' : 's'}`}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Default pull" description="What the Pull button does." htmlFor={pullId}>
        <select id={pullId} className="ui-input md-select" value={s.defaultPullMode} onChange={(e) => update({ defaultPullMode: e.target.value as PullMode })}>
          <option value="merge">Fast-forward if possible (merge)</option>
          <option value="ff-only">Fast-forward only</option>
          <option value="rebase">Rebase</option>
        </select>
      </SettingRow>
      <SettingRow label="Confirm dangerous actions" description="Ask before force push, hard reset and discarding changes.">
        <Switch label="Confirm dangerous actions" checked={s.confirmDangerous} onChange={(confirmDangerous) => update({ confirmDangerous })} />
      </SettingRow>
      <SettingRow label="Gravatar avatars" description="Load author pictures from gravatar.com (sends a hash of the email). Initials are used otherwise.">
        <Switch label="Gravatar avatars" checked={s.gravatar} onChange={(gravatar) => update({ gravatar })} />
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
    </>
  )
}

function GraphSection() {
  const s = useSettings()
  const pageId = useId()
  return (
    <>
      <SectionTitle>Graph</SectionTitle>
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
        <div className="md-checks">
          {(['author', 'date', 'sha'] as const).map((col) => (
            <label key={col} className="ui-check">
              <input
                type="checkbox"
                checked={s.graphColumns[col]}
                onChange={(e) => update({ graphColumns: { ...s.graphColumns, [col]: e.target.checked } })}
              />
              <span>{col === 'sha' ? 'SHA' : col[0].toUpperCase() + col.slice(1)}</span>
            </label>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Commits per page" description="Loaded at once; more load as you scroll. Lower is faster on huge repositories." htmlFor={pageId}>
        <select id={pageId} className="ui-input md-select" value={s.graphPageSize} onChange={(e) => updateGraphData({ graphPageSize: Number(e.target.value) })}>
          {(PAGE_SIZES.includes(s.graphPageSize) ? PAGE_SIZES : [...PAGE_SIZES, s.graphPageSize].sort((a, b) => a - b)).map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  )
}

function DiffSection() {
  const s = useSettings()
  const ctxId = useId()
  return (
    <>
      <SectionTitle>Diff</SectionTitle>
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
      <SectionTitle>Integrations</SectionTitle>
      <SettingRow label="Editor" description="Command used by “Open in editor”. Leave empty to use the system default app." htmlFor={editorId}>
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
        description={platform && platform !== 'darwin' ? 'Terminal application used by “Open in terminal” (macOS names; other platforms use the system terminal).' : 'Terminal application used by “Open in terminal”.'}
        htmlFor={termId}
      >
        <select id={termId} className="ui-input md-select" value={s.terminalApp || 'Terminal'} onChange={(e) => update({ terminalApp: e.target.value })}>
          {terminals.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
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
      const fresh = await api.getIdentity(null).catch(() => ({ name: name.trim(), email: email.trim(), scope: 'global' as const }))
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
      <SectionTitle description="Used for commits in every repository that does not set its own identity (git config --global).">Global identity</SectionTitle>
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
            <input id={emailId} className="ui-input md-text" type="email" value={email} placeholder="jane@example.com" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
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
      <SectionTitle>About Git</SectionTitle>
      <SettingRow label="Git executable" description="Adar uses the git installed on your system, with your configuration, SSH keys and credential helpers.">
        <span className="md-value">{gitVersion ? `git ${gitVersion}` : 'unknown version'}</span>
      </SettingRow>
    </>
  )
}

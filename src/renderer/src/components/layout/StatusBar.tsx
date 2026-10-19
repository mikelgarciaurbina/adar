// Bottom status bar: live git progress / busy operations on the left, fetch time,
// branch tracking, zoom and versions on the right.

import { ArrowDown, ArrowUp, CloudDownload, GitBranch, TriangleAlert } from 'lucide-react'
import { runCommand } from '@renderer/commands'
import { relativeTime } from '@renderer/lib/format'
import { currentBranch } from '@renderer/lib/refs'
import { useActiveTab, useApp } from '@renderer/store/appStore'
import { busyLabelsFor, formatGitVersion, pickProgress, tildify } from './chrome'
import { useNow } from './hooks'
import { AdarLogo } from './Logo'
import './layout.css'

const STATE_LABEL: Record<string, string> = {
  merge: 'MERGING',
  rebase: 'REBASING',
  'rebase-interactive': 'REBASING',
  'cherry-pick': 'CHERRY-PICKING',
  revert: 'REVERTING',
  bisect: 'BISECTING',
  am: 'APPLYING PATCHES'
}

export function StatusBar() {
  const tab = useActiveTab()
  const activePath = useApp((s) => s.activePath)
  const progress = useApp((s) => s.progress)
  const busy = useApp((s) => s.busy)
  const zoom = useApp((s) => s.settings.zoom || 1)
  const appInfo = useApp((s) => s.appInfo)
  const now = useNow(30_000)

  const prog = pickProgress(progress, activePath)
  const busyLabels = busyLabelsFor(busy, activePath)
  const cur = currentBranch(tab?.refs ?? null)
  const head = tab?.refs?.head ?? tab?.info?.head
  const state = tab?.info?.state ?? 'none'
  const gitVersion = formatGitVersion(appInfo?.gitVersion)
  const percent = prog?.state.percent
  const zoomPct = Math.round(zoom * 100)

  let left: React.ReactNode
  if (prog) {
    left = (
      <span className="tb-status-progress" title={prog.state.message}>
        <span className="ui-spinner ui-spinner-sm" />
        <span className="tb-status-text">{prog.state.message || busyLabels[0] || 'Working…'}</span>
        {typeof percent === 'number' && (
          <>
            <span className="tb-status-bar" aria-hidden="true">
              <span className="tb-status-bar-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
            </span>
            <span className="tb-status-pct">{Math.round(percent)}%</span>
          </>
        )}
      </span>
    )
  } else if (busyLabels.length) {
    left = (
      <span className="tb-status-progress" title={busyLabels.join(' · ')}>
        <span className="ui-spinner ui-spinner-sm" />
        <span className="tb-status-text">{busyLabels.join(' · ')}</span>
      </span>
    )
  } else if (tab) {
    left = (
      <span className="tb-status-text tb-status-path" title={tab.path}>
        <bdi>{tildify(tab.path, appInfo?.homeDir)}</bdi>
      </span>
    )
  } else {
    left = <span className="tb-status-text">Ready</span>
  }

  return (
    <div className="tb-statusbar" role="status" aria-live="polite">
      <div className="tb-status-left">
        {state !== 'none' && (
          <span className="tb-status-state" title={`A ${state} is in progress`}>
            <TriangleAlert size={11} />
            {STATE_LABEL[state] ?? state.toUpperCase()}
          </span>
        )}
        {left}
      </div>
      <div className="tb-status-right">
        {tab && (
          <span className="tb-status-item" title={tab.lastFetch ? new Date(tab.lastFetch).toLocaleString() : 'Not fetched in this session'}>
            <CloudDownload size={11} />
            {tab.lastFetch ? `fetched ${relativeTime(Math.floor(tab.lastFetch / 1000), now)}` : 'not fetched yet'}
          </span>
        )}
        {tab && head && (
          <span
            className="tb-status-item"
            title={cur?.upstream ? `${cur.name} ↔ ${cur.upstream}${cur.upstreamGone ? ' (gone)' : ''}` : head.detached ? 'Detached HEAD' : 'No upstream'}
          >
            <GitBranch size={11} />
            <span className="tb-status-branch">{head.branch ?? (head.sha ? head.sha.slice(0, 7) : '—')}</span>
            {cur?.upstream && (
              <>
                <span className={`tb-status-ab${cur.ahead ? ' tb-status-ab-on' : ''}`}>
                  <ArrowUp size={10} />
                  {cur.ahead ?? 0}
                </span>
                <span className={`tb-status-ab${cur.behind ? ' tb-status-ab-on' : ''}`}>
                  <ArrowDown size={10} />
                  {cur.behind ?? 0}
                </span>
              </>
            )}
          </span>
        )}
        <button
          className={`tb-status-item tb-status-btn${zoomPct !== 100 ? ' tb-status-zoomed' : ''}`}
          title="Zoom — click to reset to 100%"
          onClick={() => runCommand('zoom-reset')}
        >
          {zoomPct}%
        </button>
        {appInfo && (
          <span className="tb-status-item tb-status-version" title={`Adar ${appInfo.version}${gitVersion ? ` · git ${gitVersion}` : ''} · ${appInfo.platform}`}>
            <AdarLogo bare size={13} className="tb-status-logo" />
            Adar {appInfo.version}
            {gitVersion && <> · git {gitVersion}</>}
          </span>
        )}
      </div>
    </div>
  )
}

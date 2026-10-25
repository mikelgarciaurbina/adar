// Right panel: commit details, the WIP staging area + commit composer, stash
// details, a two-commit comparison or a multi-commit summary depending on the
// current selection.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '@renderer/components/common/Button'
import { PullPanel } from '@renderer/components/pulls/PullPanel'
import type { RepoTab } from '@renderer/store/appStore'
import { CommitPanel } from './CommitPanel'
import { ComparePanel } from './ComparePanel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { ErrorBlock } from './parts'
import { StashPanel } from './StashPanel'
import { wantsWipPanel, WipPanel } from './WipPanel'
import './details.css'

function PanelContent({ tab }: { tab: RepoTab }) {
  const sel = tab.selection
  switch (sel.kind) {
    case 'wip':
      return <WipPanel tab={tab} />
    case 'commit': {
      const multi = tab.multiSelect
      if (multi.length === 2) return <ComparePanel key={`${multi[0]}:${multi[1]}`} tab={tab} a={multi[0]} b={multi[1]} />
      if (multi.length > 2) return <MultiSelectPanel tab={tab} />
      return <CommitPanel key={sel.sha} tab={tab} sha={sel.sha} />
    }
    case 'stash':
      return <StashPanel key={sel.sha} tab={tab} index={sel.index} sha={sel.sha} />
    case 'pull':
      return <PullPanel tab={tab} number={sel.number} />
    default:
      if (wantsWipPanel(tab)) return <WipPanel tab={tab} />
      return (
        <div className="det-panel">
          <EmptyState icon={<MousePointerClick size={28} />} title="Select a commit to see its details">
            Click a commit in the graph, or the WIP row to stage and commit your changes.
          </EmptyState>
        </div>
      )
  }
}

/** Keeps a rendering bug in one view from blanking the whole window; resets when the selection changes. */
class PanelErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  override state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Right panel crashed', error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="det-panel">
        <ErrorBlock message={`Could not show these details: ${this.state.error.message}`} onRetry={() => this.setState({ error: null })} />
      </div>
    )
  }
}

function selectionKey(tab: RepoTab): string {
  const s = tab.selection
  return `${tab.path}\u0000${s.kind}\u0000${'sha' in s ? s.sha : 'number' in s ? s.number : ''}\u0000${tab.multiSelect.join(',')}`
}

export function RightPanel({ tab }: { tab: RepoTab }) {
  return (
    <div className="det-root">
      <PanelErrorBoundary resetKey={selectionKey(tab)}>
        <PanelContent tab={tab} />
      </PanelErrorBoundary>
    </div>
  )
}

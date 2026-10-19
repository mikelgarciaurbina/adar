// Bottom drawer with a Git console for the active repository. Commands are split
// shell-style and passed as an argument array to git (never through a shell).

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Eraser, Terminal, X } from 'lucide-react'
import { IconButton } from '@renderer/components/common/Button'
import { clampConsoleHeight } from '@renderer/components/layout/chrome'
import { getCommand } from '@renderer/commands'
import { shortcutLabel } from '@renderer/lib/keys'
import { useApp } from '@renderer/store/appStore'
import { runConsoleLine, useConsole, type ConsoleLine } from './consoleStore'
import { HISTORY_LIMIT, loadStringList, navigateHistory, pushHistory, readJson, writeJson, type HistoryCursor } from './history'
import './palette.css'

const HEIGHT_KEY = 'adar.console.height'
const HISTORY_KEY = 'adar.console.history'
const DEFAULT_HEIGHT = 240
const EMPTY: ConsoleLine[] = []

export function GitConsole() {
  const open = useApp((s) => s.consoleOpen)
  // Hidden (not closed) on the welcome screen: it comes back when a repository opens.
  const hasRepo = useApp((s) => !!s.activePath)
  if (!open || !hasRepo) return null
  return <ConsoleDrawer />
}

function ConsoleDrawer() {
  const repo = useApp((s) => s.activePath)
  const repoName = useApp((s) => s.tabs.find((t) => t.path === s.activePath)?.name ?? null)
  const lines = useConsole((s) => (repo ? (s.logs[repo] ?? EMPTY) : EMPTY))
  const running = useConsole((s) => (repo ? !!s.running[repo] : false))
  const [height, setHeight] = useState(() => clampConsoleHeight(Number(readJson<number>(HEIGHT_KEY, DEFAULT_HEIGHT)) || DEFAULT_HEIGHT, window.innerHeight))
  const [input, setInput] = useState('')
  const history = useRef<string[]>(loadStringList(HISTORY_KEY).slice(-HISTORY_LIMIT))
  const cursor = useRef<HistoryCursor>({ index: history.current.length, draft: '' })
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const close = useCallback(() => useApp.getState().setConsoleOpen(false), [])

  // Focus the prompt when opened or when switching repositories.
  useEffect(() => {
    inputRef.current?.focus()
  }, [repo])

  // Re-clamp on window resize.
  useEffect(() => {
    const onResize = () => setHeight((h) => clampConsoleHeight(h, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Auto-scroll while the user is at the bottom.
  useLayoutEffect(() => {
    const el = outputRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines, height])

  const onScroll = () => {
    const el = outputRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    document.body.classList.add('pal-resizing')
    let latest = startH
    const move = (ev: PointerEvent) => {
      latest = clampConsoleHeight(startH - (ev.clientY - startY), window.innerHeight)
      setHeight(latest)
    }
    const up = () => {
      document.body.classList.remove('pal-resizing')
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      writeJson(HEIGHT_KEY, latest)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const submit = () => {
    if (!repo || running) return
    const line = input
    if (!line.trim()) return
    history.current = pushHistory(history.current, line)
    writeJson(HISTORY_KEY, history.current)
    cursor.current = { index: history.current.length, draft: '' }
    setInput('')
    stickToBottom.current = true
    void runConsoleLine(repo, line)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const res = navigateHistory(history.current, cursor.current, e.key === 'ArrowUp' ? -1 : 1, input)
      cursor.current = res.cursor
      setInput(res.text)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (el) el.setSelectionRange(el.value.length, el.value.length)
      })
    } else if (e.key === 'Escape') {
      // A menu, dialog or the palette above the console owns Escape.
      if (document.querySelector('.ui-menu, .ui-backdrop, .pal-overlay, .tb-popover')) return
      e.preventDefault()
      close()
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      if (repo) useConsole.getState().clear(repo)
    }
  }

  const toggleSpec = getCommand('git-console')?.shortcut
  const closeTitle = `Close console${toggleSpec ? ` (${shortcutLabel(toggleSpec)})` : ''}`

  return (
    <section className="pal-console" style={{ height }} aria-label="Git console">
      <div className="pal-console-resize" onPointerDown={onResizeStart} role="separator" aria-orientation="horizontal" aria-label="Resize console" />
      <header className="pal-console-header">
        <Terminal size={13} className="pal-console-icon" />
        <span className="pal-console-title">Git console</span>
        {repoName && (
          <span className="pal-console-repo" title={repo ?? undefined}>
            {repoName}
          </span>
        )}
        {running && <span className="ui-spinner ui-spinner-sm" aria-label="Running" />}
        <span className="pal-console-spacer" />
        <IconButton label="Clear (Ctrl+L)" size="sm" onClick={() => repo && useConsole.getState().clear(repo)} disabled={!repo || !lines.length}>
          <Eraser size={13} />
        </IconButton>
        <IconButton label={closeTitle} size="sm" onClick={close}>
          <X size={14} />
        </IconButton>
      </header>
      {!repo ? (
        <div className="pal-console-empty">Open a repository to use the Git console.</div>
      ) : (
        <>
          <div
            ref={outputRef}
            className="pal-console-output selectable"
            onScroll={onScroll}
            onMouseUp={() => {
              if (!window.getSelection()?.toString()) inputRef.current?.focus()
            }}
          >
            {lines.length === 0 ? (
              <div className="pal-console-hint">
                Run any git command in <strong>{repoName}</strong>. Your git config, SSH keys and credential helpers apply. ↑/↓ for history, Ctrl+L to
                clear, Esc to close.
              </div>
            ) : (
              <ConsoleOutput lines={lines} />
            )}
          </div>
          <form
            className={`pal-console-prompt${running ? ' pal-running' : ''}`}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <span className="pal-console-git">git</span>
            <input
              ref={inputRef}
              className="pal-console-input"
              value={input}
              placeholder={running ? 'Running…' : 'status'}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              aria-label="Git command"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </form>
        </>
      )}
    </section>
  )
}

const ConsoleOutput = memo(function ConsoleOutput({ lines }: { lines: ConsoleLine[] }) {
  return (
    <>
      {lines.map((l) => {
        switch (l.kind) {
          case 'cmd':
            return (
              <div key={l.id} className="pal-line pal-line-cmd">
                <span className="pal-line-prompt">$</span> {l.text}
              </div>
            )
          case 'exit':
            return (
              <div key={l.id} className={`pal-line pal-line-exit${l.code ? ' pal-line-exit-fail' : ''}`}>
                {l.text}
              </div>
            )
          default:
            return (
              <pre key={l.id} className={`pal-line pal-line-${l.kind}`}>
                {l.text}
              </pre>
            )
        }
      })}
    </>
  )
})

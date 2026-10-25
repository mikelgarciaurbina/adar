// "Pull requests in Adar": turning GitHub pull requests on. The GitHub CLI's sign-in is
// offered first when it is there (nothing to type, nothing stored); a personal access token
// is the fallback, kept encrypted by the operating system.

import { useEffect, useId, useState } from 'react'
import { GitPullRequest, KeyRound, ShieldCheck, SquareTerminal } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { openOnGithub } from '@renderer/actions/pulls'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { closeIfTopmost } from '@renderer/components/modals/controls'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { GithubAuthMethod } from '@shared/hosting'
import { isGithubRepo, usePulls } from './pullStore'
import './pulls.css'

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export function ConnectDialog({ next }: { next?: () => void }) {
  const connection = usePulls((s) => s.connection)
  const repoName = useApp((s) => {
    const tab = s.tabs.find((t) => t.path === s.activePath)
    return tab && isGithubRepo(tab) ? tab.name : null
  })
  const [method, setMethod] = useState<GithubAuthMethod | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Known to be signed in already: no need to say "looking" while asking again.
  const [checking, setChecking] = useState(() => usePulls.getState().connection?.ghLogin == null)
  const tokenId = useId()
  const close = () => closeIfTopmost('pr-connect')

  // Whether gh is signed in is only asked here, when the user is choosing how to sign in.
  useEffect(() => {
    void usePulls
      .getState()
      .loadConnection(true)
      .finally(() => setChecking(false))
  }, [])
  const ghFound = !checking && connection?.ghLogin != null
  const canToken = !!connection?.canStoreToken
  // Preselect what works: gh when it is signed in, else the token.
  const chosen: GithubAuthMethod | null = method ?? (checking ? null : ghFound ? 'gh' : canToken ? 'token' : null)

  const turnOn = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.connectGithub(chosen, chosen === 'token' ? token : undefined)
      usePulls.getState().setConnection(c)
      const active = useApp.getState().activePath
      if (active) void usePulls.getState().load(active, { force: true })
      useApp.getState().closeModal()
      next?.()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <GitPullRequest size={16} /> Pull requests in Adar
        </span>
      }
      className="md-modal pr-connect"
      width={540}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Not now
          </Button>
          <Button variant="primary" loading={busy} disabled={!chosen || (chosen === 'token' && !token.trim())} onClick={() => void turnOn()}>
            Turn on
          </Button>
        </>
      }
    >
      <div className="pr-connect-body">
        <p className="pr-lead">
          Adar shows the pull requests of {repoName ? <strong>{repoName}</strong> : 'your GitHub repositories'} on their branches, and creates, checks out and merges them for
          you. It asks GitHub with your own sign-in.
        </p>
        <fieldset className="pr-options">
          <legend className="pr-legend">Sign in with</legend>
          <label className={`pr-option${chosen === 'gh' ? ' pr-option-on' : ''}${ghFound ? '' : ' pr-option-off'}`}>
            <input type="radio" name="pr-auth" checked={chosen === 'gh'} disabled={!ghFound} onChange={() => setMethod('gh')} />
            <span className="pr-option-text">
              <span className="pr-option-title">
                <SquareTerminal size={15} /> GitHub CLI
                {ghFound && <span className="pr-found">Found on this {isMac ? 'Mac' : 'computer'}</span>}
              </span>
              <span className="pr-option-desc">
                {checking ? (
                  'Looking for the GitHub CLI…'
                ) : ghFound ? (
                  <>
                    {connection?.ghLogin ? (
                      <>
                        Signed in as <strong>{connection.ghLogin}</strong>.{' '}
                      </>
                    ) : null}
                    Adar asks <code>gh</code> for the token each time and keeps no copy.
                  </>
                ) : (
                  <>
                    Not found. Install the GitHub CLI and run <code>gh auth login</code>, then open this again.
                  </>
                )}
              </span>
            </span>
          </label>
          <label className={`pr-option${chosen === 'token' ? ' pr-option-on' : ''}${canToken ? '' : ' pr-option-off'}`}>
            <input type="radio" name="pr-auth" checked={chosen === 'token'} disabled={!canToken} onChange={() => setMethod('token')} />
            <span className="pr-option-text">
              <span className="pr-option-title">
                <KeyRound size={15} /> Personal access token
              </span>
              <span className="pr-option-desc">
                {canToken ? (
                  <>
                    A fine-grained token with <strong>Pull requests: Read and write</strong> (and Contents: Read).{' '}
                    <button type="button" className="ui-link" onClick={() => openOnGithub(NEW_TOKEN_URL)}>
                      Create one on GitHub
                    </button>
                    . Kept encrypted on this computer.
                  </>
                ) : (
                  'This computer offers no protected storage for a token.'
                )}
              </span>
            </span>
          </label>
          {chosen === 'token' && (
            <div className="ui-field pr-token">
              <label className="ui-label" htmlFor={tokenId}>
                Token
              </label>
              <input
                id={tokenId}
                className="ui-input ui-mono"
                type="password"
                value={token}
                placeholder="github_pat_…"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim()) void turnOn()
                }}
              />
            </div>
          )}
        </fieldset>
        {error && (
          <div className="pr-error" role="alert">
            {error}
          </div>
        )}
        <div className="pr-privacy">
          <ShieldCheck size={15} />
          <span>Adar only talks to api.github.com, only for repositories on GitHub, and only while this is on. Turn it off in Settings → Integrations.</span>
        </div>
      </div>
    </Modal>
  )
}

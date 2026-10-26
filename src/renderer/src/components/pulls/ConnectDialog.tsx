// "Pull requests in Adar": turning pull requests on, for the provider of the repository that asked.
// GitHub: the GitHub CLI's sign-in first when it is there (nothing to type, nothing stored), else a
// personal access token. GitLab (gitlab.com or an instance): a personal access token with the api
// scope. Bitbucket Cloud: the Atlassian account email and an API token. Bitbucket Data Center: the
// server's address and an HTTP access token. Tokens are kept encrypted by the system.

import { useEffect, useId, useState } from 'react'
import { GitPullRequest, KeyRound, ShieldCheck, SquareTerminal } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { openWebPage, syncHostingSettings } from '@renderer/actions/pulls'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { closeIfTopmost } from '@renderer/components/modals/controls'
import { useApp } from '@renderer/store/appStore'
import { CLOUD_TOKEN_SCOPES } from '@shared/bitbucket'
import { describeError } from '@shared/errors'
import { GITLAB_TOKEN_SCOPE } from '@shared/gitlab'
import { GITLAB_COM, type GithubAuthMethod, type HostingProvider } from '@shared/hosting'
import { knownServers, repoHosting, usePulls } from './pullStore'
import './pulls.css'

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
const ATLASSIAN_TOKENS_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'

export interface ConnectProps {
  provider: HostingProvider
  /** GitLab and Bitbucket Data Center: the server's address, as found from the remote. */
  server?: string
  /** GitLab and Bitbucket Data Center: the host of the remote that asked (its SSH host may differ from the web one). */
  remoteHost?: string
  next?: () => void
}

/** The active repository's owner/name when it lives on `provider`, for the dialog's first line. */
function useRepoLabel(provider: HostingProvider): string | null {
  return useApp((s) => {
    const h = repoHosting(s.tabs.find((t) => t.path === s.activePath), knownServers(s.settings))
    return h && h.provider === provider ? `${h.owner}/${h.name}` : null
  })
}

export function ConnectDialog(props: ConnectProps) {
  if (props.provider === 'github') return <GithubConnect next={props.next} />
  return props.provider === 'gitlab' ? <GitlabConnect {...props} /> : <BitbucketConnect {...props} />
}

function GithubConnect({ next }: { next?: () => void }) {
  const connection = usePulls((s) => s.connection)
  const repoName = useRepoLabel('github')
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
                    <button type="button" className="ui-link" onClick={() => openWebPage(NEW_TOKEN_URL)}>
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

function BitbucketConnect({ provider, server, remoteHost, next }: ConnectProps) {
  const cloud = provider === 'bitbucket-cloud'
  const canStore = usePulls((s) => s.bitbucket?.canStoreToken ?? true)
  const repoName = useRepoLabel(provider)
  const [email, setEmail] = useState(() => usePulls.getState().bitbucket?.cloud?.email ?? useApp.getState().settings.bitbucketEmail)
  const [url, setUrl] = useState(server ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { email: useId(), url: useId(), token: useId() }
  const close = () => closeIfTopmost('pr-connect')

  useEffect(() => {
    void usePulls.getState().loadBitbucket()
    // Cloud: start from the repository's Git email, the one people usually sign in to Atlassian with.
    const repo = useApp.getState().activePath
    if (cloud && !email && repo) {
      api
        .getIdentity(repo)
        .then((id) => setEmail((e) => e || id.email || ''))
        .catch(() => undefined)
    }
    // Run once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = ''
  }
  const ready = !!token.trim() && (cloud ? !!email.trim() : !!host)

  const turnOn = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.connectBitbucket(cloud ? { kind: 'cloud', email: email.trim(), token: token.trim() } : { kind: 'server', url: url.trim(), token: token.trim(), remoteHost })
      usePulls.getState().setBitbucket(c)
      // A newly known server can change which remotes count as Bitbucket.
      await syncHostingSettings()
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
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready) void turnOn()
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
          <Button variant="primary" loading={busy} disabled={!ready || !canStore} onClick={() => void turnOn()}>
            Turn on
          </Button>
        </>
      }
    >
      <div className="pr-connect-body">
        <p className="pr-lead">
          Adar shows the pull requests of {repoName ? <strong>{repoName}</strong> : 'your repositories'} on {cloud ? 'Bitbucket' : 'your Bitbucket server'} on their
          branches, and creates, checks out and merges them for you. It asks {cloud ? 'Bitbucket' : 'the server'} with {cloud ? 'an API token' : 'an HTTP access token'} of
          yours.
        </p>
        {cloud ? (
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.email}>
              Atlassian account email
            </label>
            <input id={ids.email} className="ui-input" type="email" value={email} autoComplete="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <span className="ui-hint">Filled in from your Git email.</span>
          </div>
        ) : (
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.url}>
              Bitbucket address
            </label>
            <input id={ids.url} className="ui-input ui-mono" type="url" value={url} autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} onKeyDown={onEnter} />
            <span className="ui-hint">From the remote. Change it if Bitbucket's web address is a different one.</span>
          </div>
        )}
        <div className="ui-field">
          <label className="ui-label" htmlFor={ids.token}>
            {cloud ? 'API token' : 'HTTP access token'}
          </label>
          <input
            id={ids.token}
            className="ui-input ui-mono"
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={onEnter}
          />
          {cloud ? (
            <span className="ui-hint">
              In your{' '}
              <button type="button" className="ui-link" onClick={() => openWebPage(ATLASSIAN_TOKENS_URL)}>
                Atlassian API tokens
              </button>
              , choose <strong>Create API token with scopes</strong>, pick <strong>Bitbucket</strong> as the app and select{' '}
              {CLOUD_TOKEN_SCOPES.map((scope, i) => (
                <span key={scope}>
                  <code>{scope}</code>
                  {i < CLOUD_TOKEN_SCOPES.length - 2 ? ', ' : i === CLOUD_TOKEN_SCOPES.length - 2 ? ' and ' : '.'}
                </span>
              ))}
            </span>
          ) : (
            <span className="ui-hint">
              {host ? (
                <button type="button" className="ui-link" onClick={() => openWebPage(`${url.replace(/\/+$/, '')}/plugins/servlet/access-tokens/manage`)}>
                  Create one in Bitbucket
                </button>
              ) : (
                'Create one in Bitbucket'
              )}{' '}
              (Manage account → HTTP access tokens) with <strong>Repository write</strong> permission.
            </span>
          )}
        </div>
        {!canStore && (
          <div className="pr-error" role="alert">
            This computer offers no protected storage for a token.
          </div>
        )}
        {error && (
          <div className="pr-error" role="alert">
            {error}
          </div>
        )}
        <div className="pr-privacy">
          <ShieldCheck size={15} />
          <span>
            Adar only talks to {cloud ? 'api.bitbucket.org' : host || 'your Bitbucket server'}, only for {cloud ? 'repositories on Bitbucket Cloud' : 'its repositories'}, and only while this is
            on. The token is kept encrypted on this computer.
          </span>
        </div>
      </div>
    </Modal>
  )
}

function GitlabConnect({ server, remoteHost, next }: ConnectProps) {
  const canStore = usePulls((s) => s.gitlab?.canStoreToken ?? true)
  const repoName = useRepoLabel('gitlab')
  const [url, setUrl] = useState(server ?? GITLAB_COM)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { url: useId(), token: useId() }
  const close = () => closeIfTopmost('pr-connect')
  // gitlab.com needs no address; an instance shows the one guessed from the remote.
  const com = (server ?? GITLAB_COM) === GITLAB_COM

  useEffect(() => {
    void usePulls.getState().loadGitlab()
  }, [])

  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = ''
  }
  const ready = !!token.trim() && !!host
  const base = url.trim().replace(/\/+$/, '')

  const turnOn = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      usePulls.getState().setGitlab(await api.connectGitlab({ url: base, token: token.trim(), remoteHost }))
      // A newly known instance can change which remotes count as GitLab.
      await syncHostingSettings()
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
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready) void turnOn()
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <GitPullRequest size={16} /> Merge requests in Adar
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
          <Button variant="primary" loading={busy} disabled={!ready || !canStore} onClick={() => void turnOn()}>
            Turn on
          </Button>
        </>
      }
    >
      <div className="pr-connect-body">
        <p className="pr-lead">
          Adar shows the merge requests of {repoName ? <strong>{repoName}</strong> : 'your repositories'} on {com ? 'GitLab' : 'your GitLab'} on their branches, and
          creates, checks out and merges them for you. It asks GitLab with a personal access token of yours.
        </p>
        {!com && (
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.url}>
              GitLab address
            </label>
            <input id={ids.url} className="ui-input ui-mono" type="url" value={url} autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} onKeyDown={onEnter} />
            <span className="ui-hint">From the remote. Change it if GitLab's web address is a different one.</span>
          </div>
        )}
        <div className="ui-field">
          <label className="ui-label" htmlFor={ids.token}>
            Personal access token
          </label>
          <input
            id={ids.token}
            className="ui-input ui-mono"
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={onEnter}
          />
          <span className="ui-hint">
            {host ? (
              <button type="button" className="ui-link" onClick={() => openWebPage(`${base}/-/user_settings/personal_access_tokens?name=Adar&scopes=${GITLAB_TOKEN_SCOPE}`)}>
                Create one in GitLab
              </button>
            ) : (
              'Create one in GitLab'
            )}{' '}
            (Edit profile → Access tokens) with the <code>{GITLAB_TOKEN_SCOPE}</code> scope.
          </span>
        </div>
        {!canStore && (
          <div className="pr-error" role="alert">
            This computer offers no protected storage for a token.
          </div>
        )}
        {error && (
          <div className="pr-error" role="alert">
            {error}
          </div>
        )}
        <div className="pr-privacy">
          <ShieldCheck size={15} />
          <span>
            Adar only talks to {host || 'your GitLab'}, only for its repositories, and only while this is on. The token is kept encrypted on this computer.
          </span>
        </div>
      </div>
    </Modal>
  )
}

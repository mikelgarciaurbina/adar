// "Pull requests in Adar": turning pull requests on, for the provider of the repository that asked.
// GitHub (github.com or a GitHub Enterprise server): the GitHub CLI's sign-in first when it is there
// (nothing to type, nothing stored), else signing in on github.com from the browser (a code to type there,
// OAuth's device flow) or a personal access token. GitLab (gitlab.com or an instance): a personal access token with the api
// scope. Bitbucket Cloud: the Atlassian account email and an API token. Bitbucket Data Center: the
// server's address and an HTTP access token. Azure DevOps: a personal access token for the repository's
// organization, with the Code (Read & write) scope. Tokens are kept encrypted by the system.

import { useEffect, useId, useRef, useState } from 'react'
import { Copy, ExternalLink, Globe, GitPullRequest, KeyRound, ShieldCheck, SquareTerminal } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { copyText } from '@renderer/actions/git'
import { openWebPage, syncHostingSettings } from '@renderer/actions/pulls'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { closeIfTopmost } from '@renderer/components/modals/controls'
import { useApp } from '@renderer/store/appStore'
import { AZURE_TOKEN_SCOPE } from '@shared/azure'
import { CLOUD_TOKEN_SCOPES } from '@shared/bitbucket'
import { describeError } from '@shared/errors'
import { GITLAB_TOKEN_SCOPE } from '@shared/gitlab'
import { AZURE_DEVOPS, GITLAB_COM, type GithubAuthMethod, type GithubConnection, type GithubDeviceCode, type HostingProvider } from '@shared/hosting'
import { knownServers, repoHosting, usePulls } from './pullStore'
import './pulls.css'

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
const ATLASSIAN_TOKENS_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'

type GitlabMethod = 'glab' | 'git' | 'token'

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
  if (props.provider === 'github') return <GithubConnect {...props} />
  if (props.provider === 'azure') return <AzureConnect {...props} />
  return props.provider === 'gitlab' ? <GitlabConnect {...props} /> : <BitbucketConnect {...props} />
}

function GithubConnect({ server, remoteHost, next }: ConnectProps) {
  const connection = usePulls((s) => s.connection)
  const repoName = useRepoLabel('github')
  // A GitHub Enterprise server: its address (from the remote, changeable), and gh's sign-in for its host.
  const enterprise = !!server
  const [url, setUrl] = useState(server ?? '')
  const [method, setMethod] = useState<GithubAuthMethod | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Signing in from the browser: the code to type on GitHub, while Adar waits for it to be approved.
  const [device, setDevice] = useState<GithubDeviceCode | null>(null)
  const deviceId = useRef<string | null>(null)
  // Known to be signed in already: no need to say "looking" while asking again.
  const [checking, setChecking] = useState(() => enterprise || usePulls.getState().connection?.ghLogin == null)
  const ids = { url: useId(), token: useId() }
  const tokenId = ids.token
  const close = () => closeIfTopmost('pr-connect')
  const base = url.trim().replace(/\/+$/, '')
  let host = 'github.com'
  if (enterprise) {
    try {
      host = new URL(base).host
    } catch {
      host = ''
    }
  }

  // Whether gh is signed in is only asked here, when the user is choosing how to sign in.
  useEffect(() => {
    void usePulls
      .getState()
      .loadConnection(true, server)
      .finally(() => setChecking(false))
  }, [server])
  const ghFound = !checking && connection?.ghLogin != null
  const canToken = !!connection?.canStoreToken
  // github.com only: GitHub Enterprise servers would each need their own OAuth app.
  const canBrowser = !enterprise && !!connection?.canUseBrowser
  // Preselect what works: gh when it is signed in, else the browser, else the token.
  const chosen: GithubAuthMethod | null = method ?? (checking ? null : ghFound ? 'gh' : canBrowser ? 'browser' : canToken ? 'token' : null)

  const done = async (c: GithubConnection) => {
    usePulls.getState().setConnection(c)
    // A newly known server changes which remotes count as GitHub.
    if (enterprise) await syncHostingSettings()
    const active = useApp.getState().activePath
    if (active) void usePulls.getState().load(active, { force: true })
    useApp.getState().closeModal()
    next?.()
  }

  const stopWaiting = () => {
    if (deviceId.current) void api.cancelGithubSignIn(deviceId.current).catch(() => undefined)
    deviceId.current = null
    setDevice(null)
  }

  const turnOn = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      if (chosen === 'browser') {
        const code = await api.startGithubSignIn()
        deviceId.current = code.id
        setDevice(code)
        // The code is on the clipboard by the time GitHub's page asks for it.
        void navigator.clipboard?.writeText(code.userCode).catch(() => undefined)
        openWebPage(code.verificationUri)
        return
      }
      await done(await api.connectGithub(chosen, chosen === 'token' ? token : undefined, enterprise ? { url: base, remoteHost } : undefined))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  // While the code is shown, ask whether it was approved, as often as GitHub allows.
  useEffect(() => {
    if (!device) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const check = async () => {
      try {
        const c = await api.checkGithubSignIn(device.id)
        if (stopped) return
        if (c) {
          deviceId.current = null
          await done(c)
          return
        }
        timer = setTimeout(() => void check(), device.interval * 1000)
      } catch (err) {
        if (stopped) return
        deviceId.current = null
        setDevice(null)
        setError(describeError(err))
      }
    }
    timer = setTimeout(() => void check(), device.interval * 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // done() only reads the store and the props the dialog was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device])

  // Closing the dialog gives the code up.
  useEffect(
    () => () => {
      if (deviceId.current) void api.cancelGithubSignIn(deviceId.current).catch(() => undefined)
    },
    []
  )

  if (device) {
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
          <Button variant="ghost" onClick={stopWaiting}>
            Back
          </Button>
        }
      >
        <div className="pr-connect-body">
          <p className="pr-lead">
            Enter this code on GitHub and approve <strong>Adar</strong>. It is already on the clipboard.
          </p>
          <div className="pr-device">
            <span className="pr-device-code" aria-label={`Code ${device.userCode.split('').join(' ')}`}>
              {device.userCode}
            </span>
            <div className="pr-device-actions">
              <Button size="sm" onClick={() => void copyText(device.userCode, 'Copied the code')}>
                <Copy size={13} /> Copy code
              </Button>
              <Button size="sm" onClick={() => openWebPage(device.verificationUri)}>
                <ExternalLink size={13} /> Open GitHub
              </Button>
            </div>
          </div>
          <div className="pr-device-wait" role="status">
            <span className="ui-spinner ui-spinner-sm" aria-hidden />
            Waiting for GitHub… This window carries on by itself once you approve.
          </div>
          <div className="pr-privacy">
            <ShieldCheck size={15} />
            <span>
              Adar keeps the token GitHub gives it encrypted on this computer, and uses it only for pull requests. Revoke it any time in GitHub → Settings → Applications.
            </span>
          </div>
        </div>
      </Modal>
    )
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
          <Button variant="primary" loading={busy} disabled={!chosen || !host || (chosen === 'token' && !token.trim())} onClick={() => void turnOn()}>
            {chosen === 'browser' ? 'Continue on GitHub' : 'Turn on'}
          </Button>
        </>
      }
    >
      <div className="pr-connect-body">
        <p className="pr-lead">
          Adar shows the pull requests of {repoName ? <strong>{repoName}</strong> : 'your GitHub repositories'}
          {enterprise ? ` on ${host || 'your GitHub Enterprise server'}` : ''} on their branches, and creates, checks out and merges them for you. It asks GitHub with your
          own sign-in.
        </p>
        {enterprise && (
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.url}>
              GitHub Enterprise address
            </label>
            <input id={ids.url} className="ui-input ui-mono" type="url" value={url} autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
            <span className="ui-hint">From the remote. Change it if the server's web address is a different one.</span>
          </div>
        )}
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
                    Not found. Install the GitHub CLI and run <code>{enterprise ? `gh auth login --hostname ${host || '<host>'}` : 'gh auth login'}</code>, then open this
                    again.
                  </>
                )}
              </span>
            </span>
          </label>
          {canBrowser && (
            <label className={`pr-option${chosen === 'browser' ? ' pr-option-on' : ''}`}>
              <input type="radio" name="pr-auth" checked={chosen === 'browser'} onChange={() => setMethod('browser')} />
              <span className="pr-option-text">
                <span className="pr-option-title">
                  <Globe size={15} /> Sign in on GitHub
                </span>
                <span className="pr-option-desc">
                  Adar shows a code, you enter it on github.com and approve Adar. The token GitHub gives it is kept encrypted on this computer.
                </span>
              </span>
            </label>
          )}
          <label className={`pr-option${chosen === 'token' ? ' pr-option-on' : ''}${canToken ? '' : ' pr-option-off'}`}>
            <input type="radio" name="pr-auth" checked={chosen === 'token'} disabled={!canToken} onChange={() => setMethod('token')} />
            <span className="pr-option-text">
              <span className="pr-option-title">
                <KeyRound size={15} /> Personal access token
              </span>
              <span className="pr-option-desc">
                {canToken && enterprise ? (
                  <>
                    A token with the <code>repo</code> scope.{' '}
                    {host ? (
                      <button type="button" className="ui-link" onClick={() => openWebPage(`${base}/settings/tokens/new?scopes=repo&description=Adar`)}>
                        Create one on {host}
                      </button>
                    ) : (
                      `Create one on the server`
                    )}
                    . Kept encrypted on this computer.
                  </>
                ) : canToken ? (
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
                placeholder={enterprise ? 'ghp_…' : 'github_pat_…'}
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
          <span>
            Adar only talks to {enterprise ? host || 'your server' : 'api.github.com'}, only for {enterprise ? 'its repositories' : 'repositories on GitHub'}, and only while
            this is on. Turn it off in Settings → Integrations.
          </span>
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
  const gitlab = usePulls((s) => s.gitlab)
  const canStore = gitlab?.canStoreToken ?? true
  const repoName = useRepoLabel('gitlab')
  const [url, setUrl] = useState(server ?? GITLAB_COM)
  const [method, setMethod] = useState<GitlabMethod | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const ids = { url: useId(), token: useId() }
  const close = () => closeIfTopmost('pr-connect')
  // gitlab.com needs no address; an instance shows the one guessed from the remote.
  const com = (server ?? GITLAB_COM) === GITLAB_COM

  // What glab and git's credential helper have for this GitLab is only asked here, while choosing how to sign in.
  useEffect(() => {
    void usePulls
      .getState()
      .loadGitlab(server ?? GITLAB_COM)
      .finally(() => setChecking(false))
  }, [server])

  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = ''
  }
  const found = checking ? null : (gitlab?.found ?? { glab: false, git: false })
  // Preselect what needs nothing typed: glab, then git's token, else a token of your own.
  const chosen: GitlabMethod | null = method ?? (checking ? null : found?.glab ? 'glab' : found?.git ? 'git' : canStore ? 'token' : null)
  const ready = !!host && !!chosen && (chosen !== 'token' || (!!token.trim() && canStore))
  const base = url.trim().replace(/\/+$/, '')

  const turnOn = async () => {
    if (!ready || !chosen) return
    setBusy(true)
    setError(null)
    try {
      usePulls.getState().setGitlab(await api.connectGitlab({ url: base, method: chosen, token: chosen === 'token' ? token.trim() : undefined, remoteHost }))
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
  const option = (value: GitlabMethod, available: boolean, title: React.ReactNode, desc: React.ReactNode) => (
    <label className={`pr-option${chosen === value ? ' pr-option-on' : ''}${available ? '' : ' pr-option-off'}`}>
      <input type="radio" name="pr-gitlab-auth" checked={chosen === value} disabled={!available} onChange={() => setMethod(value)} />
      <span className="pr-option-text">
        <span className="pr-option-title">{title}</span>
        <span className="pr-option-desc">{desc}</span>
      </span>
    </label>
  )

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
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void turnOn()}>
            Turn on
          </Button>
        </>
      }
    >
      <div className="pr-connect-body">
        <p className="pr-lead">
          Adar shows the merge requests of {repoName ? <strong>{repoName}</strong> : 'your repositories'} on {com ? 'GitLab' : 'your GitLab'} on their branches, and
          creates, checks out and merges them for you. It asks GitLab with your own sign-in.
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
        <fieldset className="pr-options">
          <legend className="pr-legend">Sign in with</legend>
          {option(
            'glab',
            !!found?.glab,
            <>
              <SquareTerminal size={15} /> GitLab CLI
              {found?.glab && <span className="pr-found">Found on this {isMac ? 'Mac' : 'computer'}</span>}
            </>,
            checking ? (
              'Looking for the GitLab CLI…'
            ) : found?.glab ? (
              <>
                Signed in to {host}. Adar asks <code>glab</code> for the token each time and keeps no copy.
              </>
            ) : (
              <>
                Not signed in to {host || 'this GitLab'}. Run <code>glab auth login{com ? '' : ` --hostname ${host || '<host>'}`}</code>, then open this again.
              </>
            )
          )}
          {option(
            'git',
            !!found?.git,
            <>
              <KeyRound size={15} /> The token git uses
              {found?.git && <span className="pr-found">Found</span>}
            </>,
            checking ? (
              'Asking git’s credential helper…'
            ) : found?.git ? (
              <>Git keeps a token for {host} to push and pull over https. Adar asks git for it each time and keeps no copy.</>
            ) : (
              <>Git keeps no token for {host || 'this GitLab'}.</>
            )
          )}
          {option(
            'token',
            canStore,
            <>
              <KeyRound size={15} /> Personal access token
            </>,
            canStore ? (
              <>
                {host ? (
                  <button type="button" className="ui-link" onClick={() => openWebPage(`${base}/-/user_settings/personal_access_tokens?name=Adar&scopes=${GITLAB_TOKEN_SCOPE}`)}>
                    Create one in GitLab
                  </button>
                ) : (
                  'Create one in GitLab'
                )}{' '}
                (Edit profile → Access tokens) with the <code>{GITLAB_TOKEN_SCOPE}</code> scope. Kept encrypted on this computer.
              </>
            ) : (
              'This computer offers no protected storage for a token.'
            )
          )}
          {chosen === 'token' && (
            <div className="ui-field pr-token">
              <label className="ui-label" htmlFor={ids.token}>
                Token
              </label>
              <input
                id={ids.token}
                className="ui-input ui-mono"
                type="password"
                value={token}
                placeholder="glpat-…"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={onEnter}
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
          <span>Adar only talks to {host || 'your GitLab'}, only for its repositories, and only while this is on. A token of your own is kept encrypted on this computer.</span>
        </div>
      </div>
    </Modal>
  )
}

function AzureConnect({ server, next }: ConnectProps) {
  const canStore = usePulls((s) => s.azure?.canStoreToken ?? true)
  const repoName = useRepoLabel('azure')
  const [url, setUrl] = useState(server ?? `${AZURE_DEVOPS}/`)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { url: useId(), token: useId() }
  const close = () => closeIfTopmost('pr-connect')

  useEffect(() => {
    void usePulls.getState().loadAzure()
  }, [])

  const base = url.trim().replace(/\/+$/, '')
  const org = base.startsWith(`${AZURE_DEVOPS}/`) ? decodeURIComponent(base.slice(AZURE_DEVOPS.length + 1)) : ''
  const ready = !!token.trim() && !!org && !org.includes('/')

  const turnOn = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      usePulls.getState().setAzure(await api.connectAzure({ url: base, token: token.trim() }))
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
          Adar shows the pull requests of {repoName ? <strong>{repoName}</strong> : 'your repositories'} on Azure DevOps on their branches, with their builds,
          reviewers and branch policies, and creates, checks out and completes them for you. It asks Azure DevOps with a personal access token of yours.
        </p>
        {server ? (
          <div className="ui-field">
            <span className="ui-label">Organization</span>
            <span className="pr-org">
              <strong>{org}</strong> <span className="ui-hint">{base.replace('https://', '')}</span>
            </span>
          </div>
        ) : (
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.url}>
              Organization address
            </label>
            <input id={ids.url} className="ui-input ui-mono" type="url" value={url} autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} onKeyDown={onEnter} />
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
            {org ? (
              <button type="button" className="ui-link" onClick={() => openWebPage(`${base}/_usersSettings/tokens`)}>
                Create one in Azure DevOps
              </button>
            ) : (
              'Create one in Azure DevOps'
            )}{' '}
            (User settings → Personal access tokens) for this organization, with the <strong>{AZURE_TOKEN_SCOPE}</strong> scope.
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
            Adar only talks to dev.azure.com{org ? `/${org}` : ''}, only for its repositories, and only while this is on. The token is kept encrypted on this computer.
          </span>
        </div>
      </div>
    </Modal>
  )
}

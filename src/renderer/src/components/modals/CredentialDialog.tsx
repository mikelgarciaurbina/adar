// Answers credential prompts raised by git / ssh through the askpass bridge
// (usernames, passwords / tokens, SSH passphrases, host-key yes/no questions).
// The typed value is only held in component state and sent to the backend;
// it is never logged or persisted.

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, KeyRound, ServerCog, ShieldCheck } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { useApp, type CredentialRequest } from '@renderer/store/appStore'
import { credentialHint, credentialIsSecret, credentialLabel, credentialTitle, inferKind, parseCredentialTarget, parseSshServerPrompt } from './credentials'
import './modals.css'

export function CredentialDialog() {
  const req = useApp((s) => s.credentialQueue[0])
  const queued = useApp((s) => s.credentialQueue.length)
  if (!req) return null
  return <CredentialPrompt key={req.id} req={req} queued={queued - 1} />
}

function CredentialPrompt({ req, queued }: { req: CredentialRequest; queued: number }) {
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const answered = useRef(false)

  const kind = inferKind(req.kind, req.prompt)
  const secret = credentialIsSecret(req)
  const target = parseCredentialTarget(req.prompt)
  // Free text chosen by an SSH server (keyboard-interactive): shown as the server's words, never trusted.
  const server = parseSshServerPrompt(req.prompt)
  const hint = credentialHint(req.kind, req.prompt)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  const answer = async (v: string | null) => {
    if (answered.current) return
    answered.current = true
    setSending(true)
    try {
      await api.answerCredentialRequest(req.id, v)
    } catch (err) {
      // The request may have timed out on the backend; report without the value.
      toast.error(err)
    } finally {
      setValue('')
      useApp.getState().shiftCredentialRequest(req.id)
    }
  }

  const submit = () => {
    if (kind === 'yesno') return
    if (kind === 'username' && !value.trim()) return
    void answer(value)
  }

  return (
    <Modal
      title={
        <span className="md-title">
          {kind === 'yesno' ? <ShieldCheck size={16} /> : server ? <ServerCog size={16} /> : <KeyRound size={16} />} {credentialTitle(req.kind, req.prompt)}
        </span>
      }
      className="md-modal md-credential"
      width={480}
      dismissable={false}
      onClose={() => void answer(null)}
      footer={
        kind === 'yesno' ? (
          <>
            <Button onClick={() => void answer('no')} disabled={sending}>
              No
            </Button>
            <Button variant="primary" onClick={() => void answer('yes')} disabled={sending} autoFocus>
              Yes
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => void answer(null)} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={sending} disabled={kind === 'username' && !value.trim()}>
              Submit
            </Button>
          </>
        )
      }
    >
      <form
        className="ui-form"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {server ? (
          <>
            <div className="md-cred-target">
              <span className="md-tag">SSH</span>
              <span className="md-cred-host">{server.host}</span>
              <span className="md-cred-user">as {server.user}</span>
            </div>
            <div className="md-cred-server-caption">The server says:</div>
            <blockquote className="md-cred-prompt md-cred-server-text selectable">{server.message || '(no text)'}</blockquote>
            <div className="md-cred-warn" role="note">
              This text comes from the SSH server {server.host}, not from Adar or git, and the server can write anything here. Only answer
              if you expect {server.host} itself to ask for it — never enter a password or token for another service (such as GitHub).
            </div>
          </>
        ) : (
          <div className="md-cred-prompt selectable">{req.prompt.trim() || 'Git is asking for input.'}</div>
        )}
        {target && (
          <div className="md-cred-target">
            <span className="md-tag">{target.protocol.toUpperCase()}</span>
            <span className="md-cred-host">{target.host}</span>
            {target.user && <span className="md-cred-user">as {target.user}</span>}
          </div>
        )}
        {kind !== 'yesno' && (
          <div className="ui-field">
            <label className="ui-label" htmlFor={`cred-${req.id}`}>
              {credentialLabel(req.kind, req.prompt)}
            </label>
            <div className="md-cred-input">
              <input
                id={`cred-${req.id}`}
                ref={inputRef}
                className="ui-input"
                type={secret && !reveal ? 'password' : 'text'}
                value={value}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={sending}
                onChange={(e) => setValue(e.target.value)}
              />
              {secret && (
                <button
                  type="button"
                  className="md-cred-reveal"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide' : 'Show'}
                  title={reveal ? 'Hide' : 'Show'}
                  tabIndex={-1}
                >
                  {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          </div>
        )}
        {hint && <div className="md-cred-hint">{hint}</div>}
        {queued > 0 && <div className="md-cred-queue">{queued} more request{queued === 1 ? '' : 's'} waiting</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

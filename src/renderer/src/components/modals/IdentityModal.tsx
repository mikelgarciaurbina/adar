// Author identity for one repository (local config) or globally (repo = null).

import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Button, Spinner } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { Identity } from '@shared/types'
import { closeIfTopmost, Segmented, TextField } from './controls'
import { scopeDescription, validateIdentity } from './identity'

export function IdentityModal({ repo }: { repo: string | null }) {
  const repoName = useApp((s) => (repo ? (s.tabs.find((t) => t.path === repo)?.name ?? repo) : null))
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [target, setTarget] = useState<'local' | 'global'>(repo ? 'local' : 'global')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api.getIdentity(repo).then(
      (id) => {
        if (!alive) return
        setIdentity(id)
        setName(id.name)
        setEmail(id.email)
      },
      (err) => alive && setLoadError(describeError(err))
    )
    return () => {
      alive = false
    }
  }, [repo])

  const error = validateIdentity(name, email)

  const save = async () => {
    setTouched(true)
    if (error || saving) return
    setSaving(true)
    try {
      const scopeRepo = target === 'local' ? repo : null
      await api.setIdentity(scopeRepo, name.trim(), email.trim())
      toast.success(scopeRepo ? `Identity set for ${repoName}` : 'Global Git identity saved')
      if (useApp.getState().modal?.kind === 'identity') useApp.getState().closeModal()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <UserRound size={16} /> {repo ? 'Author identity' : 'Global Git identity'}
        </span>
      }
      className="md-modal md-identity"
      width={480}
      onClose={() => closeIfTopmost('md-identity')}
      footer={
        <>
          <Button onClick={() => closeIfTopmost('md-identity')}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!identity || (touched && !!error)}>
            Save
          </Button>
        </>
      }
    >
      {loadError ? (
        <div className="md-alert md-alert-error">Could not read the Git configuration: {loadError}</div>
      ) : !identity ? (
        <div className="md-loading">
          <Spinner size="sm" /> Reading git config…
        </div>
      ) : (
        <form
          className="ui-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className={`md-scope md-scope-${identity.scope}`}>
            {identity.scope === 'none' ? (
              <>No identity is configured. Git needs a name and email to create commits.</>
            ) : (
              <>
                Currently using <strong>{identity.name || '(no name)'}</strong> &lt;{identity.email || 'no email'}&gt; from {scopeDescription(identity.scope)}.
              </>
            )}
          </div>
          <TextField label="Name" value={name} onChange={setName} placeholder="Jane Doe" autoFocus error={touched && !name.trim() ? 'Name is required' : null} />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="jane@example.com"
            error={touched && error && name.trim() ? error : null}
            hint="Use the email registered with your Git host so commits are linked to your account."
          />
          {repo && (
            <div className="ui-field">
              <span className="ui-label">Save to</span>
              <Segmented
                ariaLabel="Where to save the identity"
                value={target}
                onChange={setTarget}
                options={[
                  { value: 'local', label: `This repository (${repoName})`, title: 'git config user.name / user.email in .git/config' },
                  { value: 'global', label: 'All repositories (global)', title: 'git config --global' }
                ]}
              />
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  )
}

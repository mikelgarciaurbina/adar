import { memo, useEffect, useState } from 'react'
import { usePulls } from '@renderer/components/pulls/pullStore'
import { useApp, useSettings } from '@renderer/store/appStore'
import { badgeColorsFor, initials } from '@renderer/lib/colors'
import { providerAvatar } from '@renderer/lib/providerAvatars'

const gravatarCache = new Map<string, Promise<string>>()

async function gravatarUrl(email: string, size: number): Promise<string> {
  const key = `${email.trim().toLowerCase()}|${size}`
  let p = gravatarCache.get(key)
  if (!p) {
    p = (async () => {
      const data = new TextEncoder().encode(email.trim().toLowerCase())
      const digest = await crypto.subtle.digest('SHA-256', data)
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      return `https://www.gravatar.com/avatar/${hex}?s=${size * 2}&d=404`
    })()
    gravatarCache.set(key, p)
  }
  return p
}

const GRAVATAR = 'https://www.gravatar.com/'
const failed = new Set<string>()

/** The active repository when its pull requests are on (they have loaded) and provider pictures are wanted; else null. */
function useProviderRepo(): string | null {
  const { providerAvatars } = useSettings()
  const active = useApp((s) => s.activePath)
  const on = usePulls((s) => !!active && !!s.repos[active]?.data)
  return providerAvatars && on ? active : null
}

export interface AvatarProps {
  name: string
  /** Without one (a GitHub user), the initials stay and no picture is asked for. */
  email?: string
  /** A commit of theirs: lets GitHub and Bitbucket find their account when Gravatar has no picture. */
  sha?: string
  size?: number
  className?: string
}

/**
 * Initials avatar coloured by author; upgrades to Gravatar when enabled in settings, and to the picture of their
 * account on the repository's GitHub, GitLab or Bitbucket when pull requests are on and Gravatar has none.
 */
export const Avatar = memo(function Avatar({ name, email = '', sha, size = 24, className }: AvatarProps) {
  const { gravatar } = useSettings()
  const providerRepo = useProviderRepo()
  const [src, setSrc] = useState<string | null>(null)
  // Bumped when Gravatar has no picture, to ask the provider instead.
  const [missed, setMissed] = useState(0)

  useEffect(() => {
    let alive = true
    setSrc(null)
    if (email && gravatar && !failed.has(email)) {
      void gravatarUrl(email, size).then((u) => alive && setSrc(u))
    } else if (email && sha && providerRepo) {
      void providerAvatar(providerRepo, email, sha).then((u) => alive && setSrc(u))
    }
    return () => {
      alive = false
    }
  }, [gravatar, email, sha, size, providerRepo, missed])

  const colors = badgeColorsFor(email || name)
  return (
    <span
      className={`ui-avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.4)), ...colors }}
      title={email ? `${name} <${email}>` : name}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          onError={() => {
            if (src.startsWith(GRAVATAR)) {
              failed.add(email)
              setMissed((n) => n + 1)
            } else setSrc(null)
          }}
        />
      ) : (
        initials(name || email)
      )}
    </span>
  )
})

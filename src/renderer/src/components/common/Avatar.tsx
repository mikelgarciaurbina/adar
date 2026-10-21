import { memo, useEffect, useState } from 'react'
import { useSettings } from '@renderer/store/appStore'
import { badgeColorsFor, initials } from '@renderer/lib/colors'

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

const failed = new Set<string>()

export interface AvatarProps {
  name: string
  email: string
  size?: number
  className?: string
}

/** Initials avatar coloured by author; upgrades to Gravatar when enabled in settings. */
export const Avatar = memo(function Avatar({ name, email, size = 24, className }: AvatarProps) {
  const { gravatar } = useSettings()
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSrc(null)
    if (gravatar && email && !failed.has(email)) {
      void gravatarUrl(email, size).then((u) => alive && setSrc(u))
    }
    return () => {
      alive = false
    }
  }, [gravatar, email, size])

  const colors = badgeColorsFor(email || name)
  return (
    <span
      className={`ui-avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.4)), ...colors }}
      title={`${name} <${email}>`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          onError={() => {
            failed.add(email)
            setSrc(null)
          }}
        />
      ) : (
        initials(name || email)
      )}
    </span>
  )
})

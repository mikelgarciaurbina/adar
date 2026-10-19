import { useId } from 'react'

/**
 * Adar logo ("adar" = branch in Basque): an "A" drawn with two git lanes that meet at a
 * commit, a merge edge as the crossbar, and a leaf sprouting from the top commit.
 * Same artwork as build/icon.svg. `bare` drops the rounded-square background; its commit
 * "holes" use --logo-hole (default --bg-1) so they match whatever surface it sits on.
 */
export function AdarLogo({ size = 48, className, bare = false }: { size?: number; className?: string; bare?: boolean }) {
  const id = useId().replace(/:/g, '')
  const g = (name: string) => `${name}-${id}`
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={bare ? '232 96 560 760' : '64 64 896 896'}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={g('bg')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#202838" />
          <stop offset="1" stopColor="#0c0f15" />
        </linearGradient>
        <radialGradient id={g('glow')} cx="0.5" cy="0.32" r="0.55">
          <stop offset="0" stopColor="#2ee6c5" stopOpacity="0.18" />
          <stop offset="1" stopColor="#2ee6c5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('l')} gradientUnits="userSpaceOnUse" x1="0" y1="800" x2="0" y2="280">
          <stop offset="0" stopColor="#0fb39c" />
          <stop offset="1" stopColor="#3cebcb" />
        </linearGradient>
        <linearGradient id={g('r')} gradientUnits="userSpaceOnUse" x1="0" y1="800" x2="0" y2="280">
          <stop offset="0" stopColor="#7437e8" />
          <stop offset="1" stopColor="#c08bfd" />
        </linearGradient>
        <linearGradient id={g('bar')} gradientUnits="userSpaceOnUse" x1="340" y1="0" x2="684" y2="0">
          <stop offset="0" stopColor="#2fd9bb" />
          <stop offset="1" stopColor="#a26cf9" />
        </linearGradient>
        <linearGradient id={g('leaf')} gradientUnits="userSpaceOnUse" x1="530" y1="250" x2="720" y2="120">
          <stop offset="0" stopColor="#34d070" />
          <stop offset="1" stopColor="#b6ec3a" />
        </linearGradient>
      </defs>
      {!bare && (
        <>
          <rect x="64" y="64" width="896" height="896" rx="210" fill={`url(#${g('bg')})`} />
          <rect x="64" y="64" width="896" height="896" rx="210" fill={`url(#${g('glow')})`} />
          <rect x="66" y="66" width="892" height="892" rx="208" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="4" />
        </>
      )}
      <path d="M344 772 V610 C344 500 470 420 512 330" stroke={`url(#${g('l')})`} strokeWidth="66" strokeLinecap="round" fill="none" />
      <path d="M680 772 V610 C680 500 554 420 512 330" stroke={`url(#${g('r')})`} strokeWidth="66" strokeLinecap="round" fill="none" />
      <path d="M344 618 H680" stroke={`url(#${g('bar')})`} strokeWidth="46" strokeLinecap="round" fill="none" />
      <path d="M528 244 C556 160 640 116 724 126 C708 208 632 262 528 244 Z" fill={`url(#${g('leaf')})`} />
      <path d="M540 236 C592 196 646 164 694 146" stroke="#0c2a17" strokeOpacity="0.35" strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="512" cy="300" r="72" fill={bare ? 'var(--logo-hole, var(--bg-1))' : '#0e1218'} stroke={bare ? 'var(--text-0)' : '#effffb'} strokeWidth="42" />
      <circle cx="344" cy="772" r="62" fill={bare ? 'var(--logo-hole, var(--bg-1))' : '#0e1218'} stroke="#1fcfb2" strokeWidth="40" />
      <circle cx="680" cy="772" r="62" fill={bare ? 'var(--logo-hole, var(--bg-1))' : '#0e1218'} stroke="#8a52f5" strokeWidth="40" />
    </svg>
  )
}

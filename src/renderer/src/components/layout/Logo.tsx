/**
 * Adar logo: a pair of antlers drawn with git lanes, with a commit at every tip ("adar" is Basque
 * for both a tree branch and an antler). Same artwork as build/icon.svg and the website's mark.
 * By default it is the app icon (the mark on a dark rounded tile, identical in both themes); `bare`
 * draws only the mark in --logo-mark, which each theme sets so it reads on its surfaces.
 */
export function AdarLogo({ size = 48, className, bare = false }: { size?: number; className?: string; bare?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox={bare ? '2 2 60 60' : '0 0 64 64'} aria-hidden="true" focusable="false">
      {bare ? (
        <Mark color="var(--logo-mark)" />
      ) : (
        <>
          <rect width="64" height="64" rx="15" fill="var(--logo-tile)" />
          <g transform="translate(8.6 7.4) scale(.73)">
            <Mark color="var(--logo-tile-mark)" />
          </g>
        </>
      )}
    </svg>
  )
}

/** The antlers in a 64×64 box: four lanes forking off a trunk, commits at the tips and the root. */
function Mark({ color }: { color: string }) {
  return (
    <>
      <g fill="none" stroke={color} strokeWidth="4.6" strokeLinecap="round">
        <path d="M32 55V45" />
        <path d="M32 45C25 42 12 38 11 24C10.5 17 12 12 15.5 7.5" />
        <path d="M32 45C39 42 52 38 53 24C53.5 17 52 12 48.5 7.5" />
        <path d="M11.6 31C18 29.5 23 26 24.5 19.5" />
        <path d="M52.4 31C46 29.5 41 26 39.5 19.5" />
      </g>
      <g fill={color}>
        <circle cx="15.5" cy="7.5" r="4.4" />
        <circle cx="48.5" cy="7.5" r="4.4" />
        <circle cx="24.6" cy="19" r="4.4" />
        <circle cx="39.4" cy="19" r="4.4" />
        <circle cx="32" cy="55.5" r="5.4" />
      </g>
    </>
  )
}

/** The mark as thin lanes with open commits and a trunk running off the bottom, for large decorative use. */
export function AdarAntlerLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round">
        <path d="M32 72V45" />
        <path d="M32 45C25 42 12 38 11 24C10.5 17 12 12 15.5 7.5" />
        <path d="M32 45C39 42 52 38 53 24C53.5 17 52 12 48.5 7.5" />
        <path d="M11.6 31C18 29.5 23 26 24.5 19.5" />
        <path d="M52.4 31C46 29.5 41 26 39.5 19.5" />
      </g>
      <g fill="var(--bg-0)" stroke="currentColor" strokeWidth="0.4">
        <circle cx="15.5" cy="7.5" r="1.6" />
        <circle cx="48.5" cy="7.5" r="1.6" />
        <circle cx="24.6" cy="19" r="1.6" />
        <circle cx="39.4" cy="19" r="1.6" />
        <circle cx="32" cy="55.5" r="2" />
      </g>
    </svg>
  )
}

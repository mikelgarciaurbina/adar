// A tab group's colours as CSS variables (--tb-group, --tb-group-ink: see layout.css), and the group's
// label drawn like the tab bar does, for the colour picker's and the New tab group dialog's previews.

import { groupInk, groupLine } from '@renderer/lib/groupColors'
import type { GroupColor } from '@shared/types'

/** CSS variables that colour a group's tray, label and dot. */
export function groupStyle(color: GroupColor): React.CSSProperties {
  return { '--tb-group': groupLine(color), '--tb-group-ink': groupInk(color) } as React.CSSProperties
}

/** A group's label (and a tab) as the tab bar draws them, for previews. */
export function GroupTrayPreview({ name, color, tab }: { name: string; color: GroupColor; tab?: string }) {
  return (
    <span className="tb-colour-tray" style={groupStyle(color)}>
      <span className="tb-colour-chip">
        <span className="tb-group-mark" aria-hidden="true" />
        <span className="tb-colour-name">{name || 'Group'}</span>
      </span>
      {tab && <span className="tb-colour-tab">{tab}</span>}
    </span>
  )
}

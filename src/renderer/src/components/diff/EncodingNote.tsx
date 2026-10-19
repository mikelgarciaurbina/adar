// Note in the diff header for files whose diff is not valid UTF-8 (Latin-1,
// Windows-1252, Shift-JIS…). The text is shown decoded with "�" for the bytes
// that could not be read, and hunk / line staging is unavailable for them: a
// partial patch would write those replacement characters into the file.

import { AlertTriangle } from 'lucide-react'
import type { FileDiff } from '@shared/types'

export function EncodingNote({ diff, staging }: { diff: Pick<FileDiff, 'encodingLossy'>; staging: boolean }) {
  if (!diff.encodingLossy) return null
  return (
    <div className="diff-info diff-info-warn" role="note">
      <AlertTriangle size={13} />
      <span>
        This file is not UTF-8 text: characters that cannot be decoded are shown as “�”.
        {staging && ' Line and hunk staging is turned off for it so its bytes are not corrupted: stage, unstage or discard the whole file instead.'}
      </span>
    </div>
  )
}

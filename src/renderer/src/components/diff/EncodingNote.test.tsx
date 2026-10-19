// Non-UTF-8 diffs explain why line / hunk staging is unavailable.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EncodingNote } from './EncodingNote'

describe('EncodingNote', () => {
  it('explains that line staging is unavailable for a non-UTF-8 working-tree diff', () => {
    const html = renderToStaticMarkup(<EncodingNote diff={{ encodingLossy: true }} staging />)
    expect(html).toContain('not UTF-8 text')
    expect(html).toContain('Line and hunk staging is turned off')
    expect(html).toContain('whole file')
  })

  it('only mentions the decoding for commit diffs (nothing to stage there)', () => {
    const html = renderToStaticMarkup(<EncodingNote diff={{ encodingLossy: true }} staging={false} />)
    expect(html).toContain('not UTF-8 text')
    expect(html).not.toContain('staging')
  })

  it('renders nothing for UTF-8 diffs', () => {
    expect(renderToStaticMarkup(<EncodingNote diff={{}} staging />)).toBe('')
    expect(renderToStaticMarkup(<EncodingNote diff={{ encodingLossy: false }} staging />)).toBe('')
  })
})

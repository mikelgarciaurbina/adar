// Markdown documents: picking one to preview, and making Adar the app they open with (macOS).

import { api, isElectron } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { openMarkdown } from '@renderer/components/markdown/markdownStore'
import { getActiveTab } from '@renderer/store/appStore'

export { openMarkdown }

/** Pick a Markdown file and show its preview. */
export async function openMarkdownDialog(): Promise<void> {
  if (!isElectron) return void toast.info('Markdown files open in the desktop app.')
  try {
    const file = await api.pickMarkdownFile({ defaultPath: getActiveTab()?.path })
    if (file) openMarkdown(file)
  } catch (err) {
    toast.error(err)
  }
}

/** macOS: make Adar the app Markdown files open with, after asking. */
export async function openMarkdownWithAdar(): Promise<void> {
  try {
    const already = await api.markdownDefaultApp()
    if (already === null) return void toast.info('Only Adar installed on a Mac can become the app Markdown files open with. Elsewhere, choose Adar under "Open with" in your file manager.', { duration: 8000 })
    if (already) return void toast.info('Markdown files already open with Adar.')
    const ok = await confirm({
      title: 'Open Markdown files with Adar?',
      message: 'Opening a .md file from the Finder will show its preview in Adar instead of starting another app. You can change it back in the Finder: Get Info → Open with → Change All…',
      confirmLabel: 'Open with Adar'
    })
    if (!ok) return
    await api.setMarkdownDefaultApp()
    toast.success('Markdown files now open with Adar.')
  } catch (err) {
    toast.error(err)
  }
}

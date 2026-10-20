// `adar` command-line tool: install / uninstall from the menu, palette or Settings.

import { cli, isElectron } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { AdarError } from '@shared/errors'

export async function installCliCommand(force = false): Promise<boolean> {
  if (!isElectron) {
    toast.info('The adar command is available in the desktop app.')
    return false
  }
  try {
    const st = await cli.cliInstall({ force })
    if (!st.installedAt) {
      toast.error('Could not install the adar command')
      return false
    }
    const dir = st.installedAt.replace(/\/adar$/, '')
    if (st.onPath) toast.success(`Installed ${st.installedAt}. Run "adar" in any repository folder to open it in Adar.`, { duration: 8000 })
    else toast.warning(`Installed ${st.installedAt}, but ${dir} is not on your PATH. Add it to your shell profile to use "adar".`, { duration: 0 })
    return true
  } catch (err) {
    if (err instanceof AdarError && err.code === 'CANCELLED') return false
    if (err instanceof AdarError && err.code === 'INVALID_ARGUMENT' && err.details?.length) {
      const ok = await confirm({
        title: 'Replace the existing "adar" command?',
        message: (
          <>
            <p style={{ margin: '0 0 8px' }}>Another command named adar is already installed:</p>
            <code className="selectable">{err.details[0]}</code>
          </>
        ),
        confirmLabel: 'Replace it',
        danger: true
      })
      return ok ? installCliCommand(true) : false
    }
    toast.error(err)
    return false
  }
}

export async function uninstallCliCommand(): Promise<boolean> {
  if (!isElectron) return false
  try {
    const st = await cli.cliUninstall()
    if (st.installedAt) {
      toast.error(`Could not remove ${st.installedAt}`)
      return false
    }
    toast.success('Removed the adar command')
    return true
  } catch (err) {
    if (!(err instanceof AdarError && err.code === 'CANCELLED')) toast.error(err)
    return false
  }
}

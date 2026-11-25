// The AdarApi methods of the terminals: thin calls into the TerminalManager, refused where there is none (and so are
// the files their links lead to: the browser bridge reads and opens none).

import type { AdarApi } from '@shared/api'
import { AdarError } from '@shared/errors'
import { parseTerminalNotice, type TerminalNotice } from '@shared/terminal'
import { openableFile, readTerminalImage } from './files'
import type { TerminalManager } from './manager'

type TerminalMethods = 'terminalOpen' | 'terminalAttach' | 'terminalWrite' | 'terminalResize' | 'terminalAck' | 'terminalSeen' | 'terminalClose' | 'terminalList' | 'terminalImage' | 'terminalOpenFile' | 'notifyTerminal'

export function createTerminalOps(services: {
  terminals: TerminalManager | null
  notifyTerminal(notice: TerminalNotice): void
  openFile(path: string): Promise<void>
}): Pick<AdarApi, TerminalMethods> {
  const need = (): TerminalManager => {
    if (!services.terminals) throw new AdarError({ message: 'Terminals are only available in the desktop app', code: 'INVALID_ARGUMENT' })
    return services.terminals
  }
  return {
    async terminalOpen(opts) {
      return need().open(opts)
    },
    async terminalAttach(id) {
      return need().attach(id)
    },
    async terminalWrite(id, data) {
      need().write(id, data)
    },
    async terminalResize(id, cols, rows) {
      need().resize(id, cols, rows)
    },
    async terminalAck(id, chars) {
      services.terminals?.ack(id, chars)
    },
    async terminalSeen(id) {
      services.terminals?.seen(id)
    },
    async terminalClose(id) {
      services.terminals?.close(id)
    },
    async terminalList() {
      return services.terminals?.list() ?? []
    },
    async terminalImage(p) {
      need()
      return readTerminalImage(p)
    },
    async terminalOpenFile(p) {
      need()
      await services.openFile(await openableFile(p))
    },
    async notifyTerminal(raw) {
      const notice = parseTerminalNotice(raw)
      if (!notice) throw new AdarError({ message: 'Invalid notification', code: 'INVALID_ARGUMENT' })
      services.notifyTerminal(notice)
    }
  }
}

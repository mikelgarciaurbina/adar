import type { AdarEvent } from '@shared/types'
import { createBackend, type Backend } from '../../../backend'
import { fakePlatform, tempDir } from './helpers'

export function makeBackend(userDataDir = tempDir('adar-userdata-')): { backend: Backend; events: AdarEvent[]; userDataDir: string } {
  const events: AdarEvent[] = []
  const backend = createBackend({
    platform: fakePlatform(userDataDir),
    emit: (e) => events.push(e),
    system: { fixShellPath: false }
  })
  return { backend, events, userDataDir }
}

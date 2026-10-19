import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@shared/api'

// Minimal, generic bridge. The typed client lives in the renderer (api/client.ts).
const bridge = {
  invoke(method: string, args: unknown[]): Promise<unknown> {
    return ipcRenderer.invoke(IPC_INVOKE_CHANNEL, method, args)
  },
  onEvent(listener: (event: unknown) => void): () => void {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(IPC_EVENT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, wrapped)
  },
  setZoom(factor: number): void {
    webFrame.setZoomFactor(factor)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('adarBridge', bridge)

export type AdarBridge = typeof bridge

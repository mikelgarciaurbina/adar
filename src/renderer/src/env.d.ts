/// <reference types="vite/client" />

interface AdarBridge {
  invoke(method: string, args: unknown[]): Promise<unknown>
  onEvent(listener: (event: unknown) => void): () => void
  setZoom(factor: number): void
  platform: string
}

interface Window {
  /** Present only inside Electron (see src/preload/index.ts). */
  adarBridge?: AdarBridge
}

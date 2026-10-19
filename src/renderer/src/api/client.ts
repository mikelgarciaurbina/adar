// Typed client for the backend. Uses the Electron preload bridge when present,
// otherwise the HTTP dev bridge (npm run web). Import `api` and call methods
// exactly as declared in AdarApi: `await api.getStatus(repo)`.

import type { InvokeResponse, AdarApi } from '@shared/api'
import { AdarError } from '@shared/errors'
import type { AdarEvent } from '@shared/types'
import type { UpdateApi } from '@shared/update'

type Transport = (method: string, args: unknown[]) => Promise<InvokeResponse>

const bridge = typeof window !== 'undefined' ? window.adarBridge : undefined

export const isElectron = !!bridge

const httpTransport: Transport = async (method, args) => {
  const res = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  if (!res.ok && res.status !== 400) {
    return { ok: false, error: { message: `Dev bridge error ${res.status}`, code: 'UNKNOWN' } }
  }
  return (await res.json()) as InvokeResponse
}

const transport: Transport = bridge
  ? (method, args) => bridge.invoke(method, args) as Promise<InvokeResponse>
  : httpTransport

async function invoke(method: string, args: unknown[]): Promise<unknown> {
  // Strip undefined trailing args so JSON/structured clone behave identically.
  while (args.length && args[args.length - 1] === undefined) args.pop()
  const res = await transport(method, args)
  if (res.ok) return res.value
  throw new AdarError(res.error)
}

export const api: AdarApi = new Proxy({} as AdarApi, {
  get(_t, prop) {
    if (typeof prop !== 'string') return undefined
    return (...args: unknown[]) => invoke(prop, args)
  }
})

type Listener = (event: AdarEvent) => void
const listeners = new Set<Listener>()
let connected = false

function connectEvents(): void {
  if (connected) return
  connected = true
  const deliver = (e: unknown) => {
    for (const l of [...listeners]) {
      try {
        l(e as AdarEvent)
      } catch (err) {
        console.error('[adar] event listener failed', err)
      }
    }
  }
  if (bridge) {
    bridge.onEvent(deliver)
  } else {
    const open = () => {
      const es = new EventSource('/api/events')
      es.onmessage = (m) => deliver(JSON.parse(m.data))
      es.onerror = () => {
        es.close()
        setTimeout(open, 2000)
      }
    }
    open()
  }
}

/** Subscribe to backend events. Returns an unsubscribe function. */
export function onAdarEvent(listener: Listener): () => void {
  connectEvents()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Apply UI zoom (Electron webFrame zoom, CSS zoom in the browser). */
export function setZoom(factor: number): void {
  if (bridge) bridge.setZoom(factor)
  else document.documentElement.style.setProperty('zoom', String(factor))
}

export const platform: string = bridge?.platform ?? (navigator.userAgent.includes('Mac') ? 'darwin' : 'other')
export const isMac = platform === 'darwin'

let opCounter = 0
/** Unique id for correlating 'progress' events with a long-running call. */
export function newOpId(prefix = 'op'): string {
  opCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${opCounter}`
}

/** In-app updater (Electron only; see src/shared/update.ts). */
export const updates: UpdateApi = new Proxy({} as UpdateApi, {
  get(_t, prop) {
    if (typeof prop !== 'string') return undefined
    return (...args: unknown[]) => invoke(prop, args)
  }
})

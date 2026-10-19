import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api/client'
import { useApp } from './store/appStore'
import { useUpdates } from './components/update/updateStore'
import { confirmQuit } from './components/update/restart'
import './styles/theme.css'
import './styles/base.css'
import './components/common/common.css'

// Debug/e2e handle (renderer-only; exposes nothing the UI cannot already do).
;(window as unknown as { __adar: unknown }).__adar = { store: useApp, api, updates: useUpdates }
// Asked by the main process before quitting (see src/main/quitGuard.ts).
;(window as unknown as { __adarConfirmQuit: () => Promise<boolean> }).__adarConfirmQuit = confirmQuit

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Entry of the macOS menu bar panel (src/renderer/menubar.html, shown by src/main/menuBar.ts).

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MenuBarPanel } from './MenuBarPanel'
import '../styles/theme.css'
import '../styles/base.css'
import '../components/graph/graph.css'
import './menubar.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MenuBarPanel />
  </StrictMode>
)

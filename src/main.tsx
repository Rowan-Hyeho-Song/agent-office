import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/bubbles.css'
import './styles.css'
import './styles/boardView.css'

// #693 ?fps: the frame readout for real-device measuring (production too); its own chunk, never loaded without the word
if (new URLSearchParams(location.search).has('fps')) void import('./fps/fpsMeter').then((m) => m.startFpsMeter())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

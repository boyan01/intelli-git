import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

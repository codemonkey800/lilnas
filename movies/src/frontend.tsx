import './tailwind.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './components/App'

function main() {
  const root = document.querySelector('main')
  if (!root) {
    return
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

main()

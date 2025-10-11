import './index.css'

import { createRoot } from 'react-dom/client'

import { App } from './App'

// Note: StrictMode is disabled for Three.js compatibility
// StrictMode causes double-mounting which breaks WebGL context
createRoot(document.getElementById('root')!).render(<App />)

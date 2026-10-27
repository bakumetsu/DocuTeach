import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/700.css'
import '@fontsource/noto-serif/400.css'
import '@fontsource/noto-serif/700.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/page.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

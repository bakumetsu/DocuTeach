import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/700.css'
import '@fontsource/noto-serif/400.css'
import '@fontsource/noto-serif/700.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/page.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { kvInit } from './api/kv'

async function main() {
  try {
    await kvInit()
    const { bootstrapLesson } = await import('./files/lessons')
    await bootstrapLesson()
  } catch {
    createRoot(document.getElementById('root')!).render(
      <>
        <p>Could not load your lessons.</p>
        <button onClick={() => location.reload()}>Retry</button>
      </>,
    )
    return
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void main()

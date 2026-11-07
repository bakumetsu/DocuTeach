import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/700.css'
import '@fontsource/noto-serif/400.css'
import '@fontsource/noto-serif/700.css'
import '@fontsource/noto-sans/400-italic.css'
import '@fontsource/noto-sans/700-italic.css'
import '@fontsource/noto-serif/400-italic.css'
import '@fontsource/noto-serif/700-italic.css'
import '@fontsource-variable/roboto/index.css'
import '@fontsource-variable/roboto/wght-italic.css'
import '@fontsource-variable/open-sans/index.css'
import '@fontsource-variable/open-sans/wght-italic.css'
import '@fontsource-variable/source-sans-3/index.css'
import '@fontsource-variable/source-sans-3/wght-italic.css'
import '@fontsource-variable/merriweather/index.css'
import '@fontsource-variable/merriweather/wght-italic.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/700.css'
import '@fontsource/be-vietnam-pro/400-italic.css'
import '@fontsource/be-vietnam-pro/700-italic.css'
import '@fontsource/noto-sans-mono/400.css'
import '@fontsource/noto-sans-mono/700.css'
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
  const { initTheme } = await import('./state/store')
  initTheme()
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void main()

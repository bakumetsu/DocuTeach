import { useRef } from 'react'
import { useApp } from '../state/store'

type View = 'edit' | 'student' | 'teacher'

const VIEWS: View[] = ['edit', 'student', 'teacher']
const LABELS: Record<View, string> = {
  edit: 'Edit',
  student: 'Student',
  teacher: 'Teacher',
}

export function ViewTabs() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const refs = useRef<Record<View, HTMLButtonElement | null>>({
    edit: null,
    student: null,
    teacher: null,
  })

  const select = (v: View) => {
    setView(v)
    refs.current[v]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = VIEWS.indexOf(view)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % VIEWS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + VIEWS.length) % VIEWS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = VIEWS.length - 1
    if (next === null) return
    e.preventDefault()
    select(VIEWS[next])
  }

  return (
    <div className="view-tabs" role="tablist" aria-label="View" onKeyDown={onKeyDown}>
      {VIEWS.map((v) => {
        const selected = v === view
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[v] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="view-tab"
            onClick={() => select(v)}
          >
            {LABELS[v]}
          </button>
        )
      })}
    </div>
  )
}

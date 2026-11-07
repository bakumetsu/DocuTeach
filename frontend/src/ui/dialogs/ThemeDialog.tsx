import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Dialog } from './Dialog'
import { useApp, DAY_PALETTES, NIGHT_PALETTES } from '../../state/store'
import type { PaletteId } from '../../state/store'

// Mirror of the bg / acc columns in tokens.css; a test keeps them equal.
export const SWATCHES: Record<PaletteId, { name: string; bg: string; acc: string }> = {
  violet: { name: 'Violet', bg: '#eceefb', acc: '#5a46d0' },
  sky: { name: 'Sky', bg: '#e6f0f5', acc: '#1b6a88' },
  sage: { name: 'Sage', bg: '#e8f1e9', acc: '#2c6a3d' },
  sand: { name: 'Sand', bg: '#f5ece0', acc: '#9a4219' },
  rose: { name: 'Rose', bg: '#f7e8ed', acc: '#a22c4d' },
  dusk: { name: 'Dusk', bg: '#14142a', acc: '#a99bff' },
  sea: { name: 'Sea', bg: '#111b21', acc: '#74c3d9' },
  forest: { name: 'Forest', bg: '#121c16', acc: '#8fcf9e' },
  ember: { name: 'Ember', bg: '#1c1612', acc: '#e8a478' },
  plum: { name: 'Plum', bg: '#1e1420', acc: '#eb9fb9' },
}

interface RowProps {
  label: string
  ids: readonly PaletteId[]
  selected: PaletteId
  onPick: (id: PaletteId) => void
  onFocusId: (id: PaletteId) => void
}

function PaletteRow({ label, ids, selected, onPick, onFocusId }: RowProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function move(from: number, delta: number) {
    const next = (from + delta + ids.length) % ids.length
    refs.current[next]?.focus()
    onPick(ids[next])
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(index, 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(index, -1)
    else return
    e.preventDefault()
  }

  return (
    <div className="theme-row">
      <span className="theme-row-label" id={`theme-row-${label}`}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`theme-row-${label}`} className="theme-swatches">
        {ids.map((id, i) => {
          const s = SWATCHES[id]
          const on = id === selected
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.name}
              title={s.name}
              tabIndex={on ? 0 : -1}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={on ? 'theme-swatch selected' : 'theme-swatch'}
              style={{ background: `linear-gradient(90deg, ${s.bg} 50%, ${s.acc} 50%)` }}
              onClick={() => onPick(id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onFocus={() => onFocusId(id)}
              onMouseEnter={() => onFocusId(id)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function ThemeDialog(props: { open: boolean; onClose: () => void }) {
  const dayPalette = useApp((s) => s.dayPalette)
  const nightPalette = useApp((s) => s.nightPalette)
  const setPalette = useApp((s) => s.setPalette)
  const [shown, setShown] = useState<PaletteId | null>(null)
  const name = SWATCHES[shown ?? dayPalette].name

  return (
    <Dialog open={props.open} title="Color theme" onClose={props.onClose}>
      <PaletteRow label="Day" ids={DAY_PALETTES} selected={dayPalette} onPick={setPalette} onFocusId={setShown} />
      <PaletteRow label="Night" ids={NIGHT_PALETTES} selected={nightPalette} onPick={setPalette} onFocusId={setShown} />
      <p className="theme-name" aria-live="polite">
        {name}
      </p>
    </Dialog>
  )
}

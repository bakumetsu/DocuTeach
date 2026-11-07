import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ChatMarkdown } from '../src/assistant/ChatMarkdown'

afterEach(cleanup)

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'

describe('ChatMarkdown', () => {
  it('renders a pipe table as a bordered table in a scroll wrapper', () => {
    const { container } = render(<ChatMarkdown text={TABLE} />)
    expect(container.querySelector('.chat-table-wrap > table.chat-table')).not.toBeNull()
    expect([...container.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['a', 'b'])
    expect(container.querySelectorAll('tbody tr').length).toBe(2)
    expect([...container.querySelectorAll('tbody td')].map((c) => c.textContent)).toEqual(['1', '2', '3', '4'])
  })

  it('shows raw HTML, links and images as text, never as elements', () => {
    const { container } = render(
      <ChatMarkdown text={'<script>alert(1)</script> [x](http://e.com) ![i](http://e.com/a.png)'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('[x](http://e.com)')
  })

  it('shows a half-streamed table as text until the separator row arrives', () => {
    const { container, rerender } = render(<ChatMarkdown text={'| a | b |'} />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('| a | b |')
    rerender(<ChatMarkdown text={'| a | b |\n| --- | --- |\n| 1'} />)
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('caps at 200 body rows and 12 columns in render only', () => {
    const cols = 15
    const head = '|' + Array.from({ length: cols }, (_, i) => ` h${i} |`).join('')
    const sep = '|' + ' --- |'.repeat(cols)
    const rows = Array.from({ length: 205 }, (_, r) => '|' + Array.from({ length: cols }, (_, c) => ` ${r}x${c} |`).join(''))
    const { container } = render(<ChatMarkdown text={[head, sep, ...rows].join('\n')} />)
    expect(container.querySelectorAll('th').length).toBe(12)
    expect(container.querySelectorAll('tbody tr').length).toBe(201)
    expect(container.querySelector('.chat-table-more')?.textContent).toBe('… 5 more rows')
  })

  it('renders lists, bold and inline code', () => {
    const { container } = render(<ChatMarkdown text={'- **one**\n- `two`'} />)
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('strong')?.textContent).toBe('one')
    expect(container.querySelector('code')?.textContent).toBe('two')
  })
})

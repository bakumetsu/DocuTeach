import { Dialog } from './Dialog'

export function ShortcutsDialog(props: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={props.open} title="Keyboard shortcuts" onClose={props.onClose}>
      <ul>
        <li>Ctrl/Cmd+Z — Revert</li>
        <li>Ctrl/Cmd+Shift+Z / Ctrl+Y — Redo</li>
        <li>Ctrl/Cmd+B/I/U — Bold, italic, underline</li>
        <li>Ctrl/Cmd+Enter — Toggle correct option</li>
        <li>Enter — Add option</li>
        <li>Esc — Close dialogs or discard a draft</li>
        <li>Ctrl/Cmd+S — Save</li>
      </ul>
    </Dialog>
  )
}

export function AboutDialog(props: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={props.open} title="About DocuTeach" onClose={props.onClose}>
      <p>DocuTeach, a local lesson editor. Everything stays on this PC.</p>
    </Dialog>
  )
}

import { useSyncExternalStore, useRef, useEffect, useState } from 'react';
import { Dialog } from './dialogs/Dialog';

type HostState =
  | { kind: 'confirm'; message: string; okLabel: string; resolve: (v: boolean) => void }
  | {
      kind: 'text';
      id: number;
      title: string;
      label: string;
      initial: string;
      resolve: (v: string | null) => void;
    }
  | null;

let state: HostState = null;
const listeners = new Set<() => void>();
let textRequestId = 0;

function setState(s: HostState) {
  state = s;
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot() {
  return state;
}

export function askConfirm(message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    setState({ kind: 'confirm', message, okLabel, resolve });
  });
}

export function askText(title: string, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textRequestId += 1;
    setState({
      kind: 'text',
      id: textRequestId,
      title,
      label,
      initial,
      resolve,
    });
  });
}

export function ConfirmHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!s) return null;

  if (s.kind === 'confirm') {
    return (
      <Dialog
        open
        title="Confirm"
        onClose={() => s.resolve(false)}
        onOk={() => s.resolve(true)}
      >
        <p>{s.message}</p>
      </Dialog>
    );
  }

  return (
    <TextPrompt
      key={s.id}
      title={s.title}
      label={s.label}
      initial={s.initial}
      onResolve={s.resolve}
    />
  );
}

function TextPrompt({
  title,
  label,
  initial,
  onResolve,
}: {
  title: string;
  label: string;
  initial: string;
  onResolve: (v: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const val = text.trim();

  const confirm = () => {
    if (val) onResolve(val);
  };

  return (
    <Dialog
      open
      title={title}
      onClose={() => onResolve(null)}
      onOk={confirm}
      okDisabled={!val}
    >
      <label style={{ display: 'block', marginBottom: 8 }}>{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirm();
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </Dialog>
  );
}

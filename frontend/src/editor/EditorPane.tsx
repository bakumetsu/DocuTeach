import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useApp } from '../state/store';
import { buildEditorExtensions } from './extensions-ui';
import { installPageHandlers } from './pageHandlers';
import { SelectionPopover } from './SelectionPopover';
import { ViewContext } from './ViewContext';
import { parseMarkdown } from '../markdown/parse';
import { readPageStyle, pageCssVars } from './pageStyle';
import { loadInitialMarkdown } from './initial';
import { startAutosave } from '../files/autosave';

interface InitialState {
  json: object;
  warnings: string[];
}

export function EditorPane({ hidden = false }: { hidden?: boolean }) {
  const [initial, setInitial] = useState<InitialState | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadInitialMarkdown().then((md) => {
      const { doc, warnings } = parseMarkdown(md);
      setInitial({ json: doc.toJSON(), warnings });
    });
  }, []);

  const wrapperStyle = hidden ? { display: 'none' as const } : undefined;

  return (
    <div style={wrapperStyle}>
      {initial ? (
        <EditorInner initialJson={initial} />
      ) : (
        <div className="page view-edit loading" />
      )}
    </div>
  );
}

function EditorInner({ initialJson }: { initialJson: InitialState }) {
  const meta = useApp((s) => s.docMeta);
  const prevMeta = useRef(meta);
  const stopAutosave = useRef<(() => void) | null>(null);

  const editor = useEditor({
    extensions: buildEditorExtensions({
      onSplitBlocked: () => useApp.getState().showToast('Only one split point'),
      withStream: true,
    }),
    content: initialJson.json,
    editorProps: {
      attributes: { class: 'page-content', spellcheck: 'true' },
    },
    onCreate: ({ editor: created }) => {
      useApp.getState().setEditor(created);
      useApp.getState().setWarnings(initialJson.warnings);
      stopAutosave.current = startAutosave(created);
    },
    onTransaction: ({ editor: current }) => {
      const m = current?.state.doc.attrs.meta;
      if (m !== prevMeta.current) {
        prevMeta.current = m;
        useApp.getState().setDocMeta(m);
      }
    },
    onDestroy: () => {
      stopAutosave.current?.();
      stopAutosave.current = null;
      useApp.getState().setEditor(null);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const cleanup = installPageHandlers(editor);
    return cleanup;
  }, [editor]);

  return (
    <ViewContext.Provider value="edit">
      <div className="page view-edit" style={pageCssVars(readPageStyle(meta))}>
        <EditorContent editor={editor} />
        <SelectionPopover editor={editor} />
      </div>
    </ViewContext.Provider>
  );
}

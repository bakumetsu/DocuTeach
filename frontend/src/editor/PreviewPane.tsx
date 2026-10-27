import { useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useApp } from '../state/store';
import { buildEditorExtensions } from './extensions-ui';
import { projectStudent } from './project';
import { ViewContext } from './ViewContext';
import { readPageStyle, pageCssVars } from './pageStyle';

export function PreviewPane({ mode }: { mode: 'teacher' | 'student' }) {
  const source = useApp((s) => s.editor);

  // Compute initial JSON
  const initialJson = useMemo(() => {
    if (!source) return undefined;
    if (mode === 'student') {
      return projectStudent(source.state.doc).toJSON();
    }
    return source.getJSON();
  }, [source, mode]);

  const preview = useEditor({
    editable: false,
    extensions: buildEditorExtensions(),
    content: initialJson,
    editorProps: {
      attributes: { class: 'page-content' },
    },
  });

  // Subscribe to source updates and rebuild preview content
  useEffect(() => {
    if (!source) return;

    const handler = () => {
      const newJson =
        mode === 'student'
          ? projectStudent(source.state.doc).toJSON()
          : source.getJSON();

      preview?.commands.setContent(newJson, { emitUpdate: false });
    };

    source.on('update', handler);
    return () => {
      source.off('update', handler);
    };
  }, [source, mode, preview]);

  if (!source) {
    return <div className="page" />;
  }

  const meta = source.state.doc.attrs.meta;

  return (
    <ViewContext.Provider value={mode}>
      <div
        className={`page view-${mode}`}
        style={pageCssVars(readPageStyle(meta))}
      >
        <EditorContent editor={preview} />
      </div>
    </ViewContext.Provider>
  );
}

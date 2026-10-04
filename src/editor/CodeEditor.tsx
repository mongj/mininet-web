import type { editor } from 'monaco-editor/editor/editor.api';
import { useEffect, useRef } from 'react';
import { useResolvedAppearance } from '@/components/theme-provider';
import { loadMonaco, monacoTheme } from './monaco';

interface CodeEditorProps {
  model: editor.ITextModel;
  onSave: () => void;
}

/** A Monaco view of `model`. The model, not this view, owns the content. */
export function CodeEditor({ model, onSave }: CodeEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const save = useRef(onSave);
  const appearance = useResolvedAppearance();
  const theme = useRef(monacoTheme(appearance));

  useEffect(() => {
    save.current = onSave;
  }, [onSave]);

  useEffect(() => {
    theme.current = monacoTheme(appearance);
    void loadMonaco().then((monaco) => monaco.editor.setTheme(theme.current));
  }, [appearance]);

  useEffect(() => {
    let disposed = false;
    let created: editor.IStandaloneCodeEditor | undefined;
    // Already loaded: the model could not exist otherwise.
    void loadMonaco().then((monaco) => {
      if (disposed || !container.current || model.isDisposed()) return;
      created = monaco.editor.create(container.current, {
        model,
        theme: theme.current,
        automaticLayout: true,
        fontFamily: 'Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        padding: { top: 8, bottom: 8 },
        tabSize: 4,
        fixedOverflowWidgets: true,
        stickyScroll: { enabled: false },
      });
      created.onKeyDown((event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          event.keyCode === monaco.KeyCode.KeyS
        ) {
          event.preventDefault();
          event.stopPropagation();
          save.current();
        }
      });
    });
    return () => {
      disposed = true;
      created?.dispose();
    };
  }, [model]);

  return <div ref={container} className="absolute inset-0" />;
}

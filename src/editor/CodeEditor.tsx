import type { editor } from 'monaco-editor/editor/editor.api';
import { useEffect, useRef } from 'react';
import { useResolvedAppearance } from '@/components/theme-provider';
import { loadMonaco, monacoTheme } from './monaco';

interface CodeEditorProps {
  model: editor.ITextModel;
  onSave: () => void;
}

let overflowWidgets: HTMLElement | undefined;

/** One element on the page for every editor's suggestions and hovers. */
function overflowWidgetsNode(): HTMLElement {
  if (!overflowWidgets) {
    overflowWidgets = document.createElement('div');
    // Monaco's widget styles are scoped to this class.
    overflowWidgets.className = 'monaco-editor editor-overflow-widgets';
    document.body.appendChild(overflowWidgets);
  }
  return overflowWidgets;
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
        // Suggestions and hovers may extend past the pane. They are placed
        // in the viewport, so they need a parent that nothing has transformed.
        fixedOverflowWidgets: true,
        overflowWidgetsDomNode: overflowWidgetsNode(),
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

  // Monaco hangs the context menu on this element, outside its own
  // `.monaco-editor`; `monaco-component` gives it the theme's colours.
  return <div ref={container} className="monaco-component absolute inset-0" />;
}

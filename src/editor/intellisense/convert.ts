import type {
  IMarkdownString,
  IRange,
  editor,
  languages,
} from 'monaco-editor/editor/editor.api';
import type { Monaco } from '../monaco';
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentation,
  LspHover,
  LspPosition,
  LspRange,
  LspSignatureHelp,
} from './protocol';

// LSP counts lines and columns from 0, Monaco from 1. Both count UTF-16 units.

export function toLspPosition(position: {
  lineNumber: number;
  column: number;
}): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

export function toMonacoRange(range: LspRange): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function toMarkdown(
  text: LspDocumentation | undefined,
): IMarkdownString | undefined {
  if (text === undefined) return undefined;
  if (typeof text === 'string') return text ? { value: text } : undefined;
  if (!text.value) return undefined;
  // Plain text is shown as it is, not interpreted as Markdown.
  return text.kind === 'markdown'
    ? { value: text.value }
    : { value: text.value.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&') };
}

// LSP CompletionItemKind (1-based) to the name of Monaco's equivalent.
const COMPLETION_KINDS = [
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter',
] as const satisfies ReadonlyArray<keyof typeof languages.CompletionItemKind>;

const SNIPPET_FORMAT = 2;
const DEPRECATED_TAG = 1;

export function toCompletionItem(
  monaco: Monaco,
  item: LspCompletionItem,
  wordRange: IRange,
): languages.CompletionItem {
  const kind = COMPLETION_KINDS[(item.kind ?? 1) - 1] ?? 'Text';
  const edit = item.textEdit;
  const range = !edit
    ? wordRange
    : 'range' in edit
      ? toMonacoRange(edit.range)
      : {
          insert: toMonacoRange(edit.insert),
          replace: toMonacoRange(edit.replace),
        };
  return {
    label: item.label,
    kind: monaco.languages.CompletionItemKind[kind],
    detail: item.detail,
    documentation: toMarkdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules:
      item.insertTextFormat === SNIPPET_FORMAT
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map((each) => ({
      range: toMonacoRange(each.range),
      text: each.newText,
    })),
    tags: item.tags?.includes(DEPRECATED_TAG)
      ? [monaco.languages.CompletionItemTag.Deprecated]
      : undefined,
  };
}

export function toHover(hover: LspHover): languages.Hover {
  const parts = Array.isArray(hover.contents)
    ? hover.contents
    : [hover.contents];
  const contents: IMarkdownString[] = [];
  for (const part of parts) {
    if (typeof part === 'object' && 'language' in part) {
      contents.push({ value: `\`\`\`${part.language}\n${part.value}\n\`\`\`` });
    } else {
      const markdown = toMarkdown(part);
      if (markdown) contents.push(markdown);
    }
  }
  return {
    contents,
    range: hover.range ? toMonacoRange(hover.range) : undefined,
  };
}

export function toSignatureHelp(
  help: LspSignatureHelp,
): languages.SignatureHelp {
  const activeSignature = help.activeSignature ?? 0;
  return {
    activeSignature,
    activeParameter:
      help.signatures[activeSignature]?.activeParameter ??
      help.activeParameter ??
      0,
    signatures: help.signatures.map((signature) => ({
      label: signature.label,
      documentation: toMarkdown(signature.documentation),
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        documentation: toMarkdown(parameter.documentation),
      })),
    })),
  };
}

const UNNECESSARY_TAG = 1;
const DEPRECATED_DIAGNOSTIC_TAG = 2;

function toSeverity(monaco: Monaco, severity: number | undefined) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

export function toMarker(
  monaco: Monaco,
  diagnostic: LspDiagnostic,
): editor.IMarkerData {
  const tags: editor.IMarkerData['tags'] = [];
  if (diagnostic.tags?.includes(UNNECESSARY_TAG)) {
    tags.push(monaco.MarkerTag.Unnecessary);
  }
  if (diagnostic.tags?.includes(DEPRECATED_DIAGNOSTIC_TAG)) {
    tags.push(monaco.MarkerTag.Deprecated);
  }
  return {
    ...toMonacoRange(diagnostic.range),
    severity: toSeverity(monaco, diagnostic.severity),
    message: diagnostic.message,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    source: 'basedpyright',
    tags,
  };
}

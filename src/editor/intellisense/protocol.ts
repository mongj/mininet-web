// The parts of the Language Server Protocol the editor uses.

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspMarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

export type LspDocumentation = string | LspMarkupContent;

export interface LspDiagnostic {
  range: LspRange;
  /** 1 error, 2 warning, 3 information, 4 hint. */
  severity?: number;
  code?: string | number;
  message: string;
  /** 1 unnecessary, 2 deprecated. */
  tags?: number[];
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspInsertReplaceEdit {
  insert: LspRange;
  replace: LspRange;
  newText: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: LspDocumentation;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  /** 1 plain text, 2 snippet. */
  insertTextFormat?: number;
  textEdit?: LspTextEdit | LspInsertReplaceEdit;
  additionalTextEdits?: LspTextEdit[];
  commitCharacters?: string[];
  tags?: number[];
  data?: unknown;
}

export interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

export interface LspHover {
  contents:
    | LspDocumentation
    | { language: string; value: string }
    | Array<string | { language: string; value: string }>;
  range?: LspRange;
}

export interface LspSignatureHelp {
  signatures: Array<{
    label: string;
    documentation?: LspDocumentation;
    parameters?: Array<{
      label: string | [number, number];
      documentation?: LspDocumentation;
    }>;
    activeParameter?: number;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

export interface LspSemanticTokens {
  data: number[];
}

export interface LspServerCapabilities {
  completionProvider?: { triggerCharacters?: string[] };
  signatureHelpProvider?: {
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
  };
  semanticTokensProvider?: {
    legend: { tokenTypes: string[]; tokenModifiers: string[] };
  };
}

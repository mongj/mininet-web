import { describe, expect, it } from 'vitest';
import type { Monaco } from '../../monaco';
import {
  toCompletionItem,
  toHover,
  toLspPosition,
  toMarker,
  toMonacoRange,
  toSignatureHelp,
} from '../convert';

// Only the enums the conversions read.
const monaco = {
  languages: {
    CompletionItemKind: { Text: 18, Method: 0, Class: 5, Module: 8 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    CompletionItemTag: { Deprecated: 1 },
  },
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
  MarkerTag: { Unnecessary: 1, Deprecated: 2 },
} as unknown as Monaco;

const word = {
  startLineNumber: 3,
  startColumn: 5,
  endLineNumber: 3,
  endColumn: 8,
};

describe('positions and ranges', () => {
  it('shifts between 0-based and 1-based', () => {
    expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({
      line: 0,
      character: 0,
    });
    expect(
      toMonacoRange({
        start: { line: 2, character: 4 },
        end: { line: 2, character: 9 },
      }),
    ).toEqual({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 10,
    });
  });
});

describe('toCompletionItem', () => {
  it('maps the kind and falls back to the label and the word range', () => {
    const item = toCompletionItem(monaco, { label: 'addHost', kind: 2 }, word);
    expect(item.kind).toBe(0);
    expect(item.insertText).toBe('addHost');
    expect(item.range).toEqual(word);
    expect(item.insertTextRules).toBeUndefined();
    expect(item.tags).toBeUndefined();
  });

  it('uses a text edit, snippets and the deprecated tag when given', () => {
    const item = toCompletionItem(
      monaco,
      {
        label: 'Mininet',
        kind: 7,
        insertTextFormat: 2,
        tags: [1],
        textEdit: {
          newText: 'Mininet($0)',
          insert: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          replace: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
        },
        documentation: { kind: 'markdown', value: '**doc**' },
      },
      word,
    );
    expect(item.kind).toBe(5);
    expect(item.insertText).toBe('Mininet($0)');
    expect(item.insertTextRules).toBe(4);
    expect(item.tags).toEqual([1]);
    expect(item.range).toEqual({
      insert: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 3,
      },
      replace: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 6,
      },
    });
    expect(item.documentation).toEqual({ value: '**doc**' });
  });

  it('treats an unknown kind as text', () => {
    expect(toCompletionItem(monaco, { label: 'x', kind: 99 }, word).kind).toBe(
      18,
    );
  });
});

describe('toHover', () => {
  it('keeps Markdown and escapes plain text', () => {
    expect(
      toHover({ contents: { kind: 'markdown', value: '`a` *b*' } }).contents,
    ).toEqual([{ value: '`a` *b*' }]);
    expect(
      toHover({ contents: { kind: 'plaintext', value: 'a*b_c' } }).contents,
    ).toEqual([{ value: 'a\\*b\\_c' }]);
  });

  it('fences marked strings and drops empty parts', () => {
    expect(
      toHover({ contents: [{ language: 'python', value: 'x = 1' }, ''] })
        .contents,
    ).toEqual([{ value: '```python\nx = 1\n```' }]);
  });
});

describe('toSignatureHelp', () => {
  it('prefers the active parameter of the active signature', () => {
    const help = toSignatureHelp({
      activeSignature: 1,
      activeParameter: 0,
      signatures: [
        { label: 'f()' },
        {
          label: 'f(a, b)',
          activeParameter: 1,
          parameters: [{ label: [2, 3] }, { label: [5, 6] }],
        },
      ],
    });
    expect(help.activeSignature).toBe(1);
    expect(help.activeParameter).toBe(1);
    expect(help.signatures[0].parameters).toEqual([]);
    expect(help.signatures[1].parameters[1].label).toEqual([5, 6]);
  });
});

describe('toMarker', () => {
  it('maps severity, tags and the rule name', () => {
    const marker = toMarker(monaco, {
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 3 },
      },
      severity: 2,
      code: 'reportMissingImports',
      message: 'Import "x" could not be resolved',
      tags: [1],
    });
    expect(marker).toMatchObject({
      startLineNumber: 5,
      startColumn: 1,
      endColumn: 4,
      severity: 4,
      code: 'reportMissingImports',
      tags: [1],
    });
    const untyped = toMarker(monaco, {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: 'm',
    });
    expect(untyped.severity).toBe(1);
    expect(untyped.code).toBeUndefined();
  });
});

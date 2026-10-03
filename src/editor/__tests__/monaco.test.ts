import { describe, expect, it } from 'vitest';
import { languageFor } from '../monaco';

describe('languageFor', () => {
  it('uses the file extension, ignoring case and folders', () => {
    expect(languageFor('lab.py', '')).toBe('python');
    expect(languageFor('nets/Ring.PY', '')).toBe('python');
    expect(languageFor('run.sh', '')).toBe('shell');
    expect(languageFor('config.json', '')).toBe('json');
    expect(languageFor('notes.md', '')).toBe('markdown');
    expect(languageFor('topo.yaml', '')).toBe('yaml');
  });

  it('falls back to the shebang for names without a known extension', () => {
    expect(languageFor('run', '#!/usr/bin/env python3\nprint(1)')).toBe(
      'python',
    );
    expect(languageFor('run', '#!/bin/sh')).toBe('shell');
    expect(languageFor('run', '#!/usr/bin/env bash\necho hi')).toBe('shell');
    expect(languageFor('.py', '#!/bin/sh\n')).toBe('shell');
  });

  it('is plain text otherwise', () => {
    expect(languageFor('README', 'python is mentioned here')).toBe('plaintext');
    expect(languageFor('data.bin', '')).toBe('plaintext');
    expect(languageFor('notes', 'first\n#!/bin/sh')).toBe('plaintext');
  });
});

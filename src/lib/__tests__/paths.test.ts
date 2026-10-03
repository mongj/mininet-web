import { describe, expect, it } from 'vitest';
import {
  baseName,
  isPathWithin,
  joinPath,
  nameProblem,
  parentPath,
  rebasePath,
  topMostPaths,
} from '../paths';

describe('playground paths', () => {
  it('splits and joins around the root', () => {
    expect(parentPath('a/b/c.py')).toBe('a/b');
    expect(parentPath('c.py')).toBe('');
    expect(baseName('a/b/c.py')).toBe('c.py');
    expect(baseName('c.py')).toBe('c.py');
    expect(joinPath('', 'c.py')).toBe('c.py');
    expect(joinPath('a/b', 'c.py')).toBe('a/b/c.py');
    expect(joinPath('a/b', '.')).toBe('a/b');
    expect(joinPath('a/b', '..')).toBe('a');
  });

  it('treats a path as within itself and its ancestors only', () => {
    expect(isPathWithin('a', 'a')).toBe(true);
    expect(isPathWithin('a', 'a/b')).toBe(true);
    expect(isPathWithin('', 'a/b')).toBe(true);
    expect(isPathWithin('a', 'ab')).toBe(false);
    expect(isPathWithin('a/b', 'a')).toBe(false);
  });

  it('rebases a moved entry and everything under it', () => {
    expect(rebasePath('a', 'a', 'x/y')).toBe('x/y');
    expect(rebasePath('a/b/c.py', 'a', 'x')).toBe('x/b/c.py');
    expect(rebasePath('a/b/c.py', 'a/b', 'b')).toBe('b/c.py');
    expect(rebasePath('a/b', '', 'x')).toBe('x/a/b');
    expect(rebasePath('a/b/c.py', 'a', '')).toBe('b/c.py');
  });

  it('keeps only the outermost of nested paths', () => {
    expect(topMostPaths(['a/b', 'a', 'c', 'a/b/d', 'ab'])).toEqual([
      'a',
      'c',
      'ab',
    ]);
    expect(topMostPaths(['a', 'a'])).toEqual(['a', 'a']);
  });

  it('explains names that cannot be used', () => {
    expect(nameProblem('topo.py')).toBeNull();
    expect(nameProblem('.hidden')).toBeNull();
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('.')).not.toBeNull();
    expect(nameProblem('..')).not.toBeNull();
    expect(nameProblem('a/b')).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { toItems } from '../items';

describe('toItems', () => {
  it('drops names that start with a dot and keeps the rest', () => {
    const items = toItems('lab', [
      { name: '.gitignore', kind: 'file' },
      { name: '.git', kind: 'dir' },
      { name: '.env', kind: 'file' },
      { name: 'topo.py', kind: 'file' },
      { name: 'nets', kind: 'dir' },
    ]);

    expect(items.map((item) => item.name)).toEqual(['nets', 'topo.py']);
    expect(items.map((item) => item.path)).toEqual(['lab/nets', 'lab/topo.py']);
  });

  it('hides dot entries in nested directories and at the root', () => {
    expect(
      toItems('src', [
        { name: '.hidden', kind: 'dir' },
        { name: 'main.ts', kind: 'file' },
      ]).map((item) => item.name),
    ).toEqual(['main.ts']);
    expect(
      toItems('', [
        { name: '.mininet-web-seeded', kind: 'file' },
        { name: 'README', kind: 'file' },
      ]).map((item) => item.name),
    ).toEqual(['README']);
  });
});

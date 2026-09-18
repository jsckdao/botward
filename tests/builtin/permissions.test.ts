import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePermissions } from '../../src/tools/builtin/permissions.js';

const tmp = path.resolve('tests/fixtures');

describe('resolvePermissions', () => {
  it('returns undefined when both fields are absent', async () => {
    expect(await resolvePermissions({}, tmp)).toBeUndefined();
  });

  it('returns the inline expression', async () => {
    const r = await resolvePermissions({ permission: 'src/**' }, tmp);
    expect(r).toEqual({ expression: 'src/**', extraPatterns: [] });
  });

  it('reads a permissionFile containing a JSON array', async () => {
    const file = path.join(tmp, '__perms.json');
    await fs.writeFile(file, '["workspace/*", "src/**/*.js"]');
    try {
      const r = await resolvePermissions({ permissionFile: '__perms.json' }, tmp);
      expect(r).toEqual({
        expression: undefined,
        extraPatterns: ['workspace/*', 'src/**/*.js'],
        filePath: file,
      });
    } finally {
      await fs.unlink(file);
    }
  });

  it('combines expression and extraPatterns', async () => {
    const file = path.join(tmp, '__perms.json');
    await fs.writeFile(file, '["from-file"]');
    try {
      const r = await resolvePermissions(
        { permission: 'inline', permissionFile: '__perms.json' },
        tmp,
      );
      expect(r?.expression).toBe('inline');
      expect(r?.extraPatterns).toEqual(['from-file']);
    } finally {
      await fs.unlink(file);
    }
  });

  it('throws on non-string permission', async () => {
    // @ts-expect-error — runtime check for wrong type
    await expect(resolvePermissions({ permission: '' }, tmp)).rejects.toThrow(/non-empty/);
  });

  it('throws when permissionFile is missing', async () => {
    await expect(
      resolvePermissions({ permissionFile: 'does-not-exist.json' }, tmp),
    ).rejects.toThrow(/not found/);
  });

  it('throws when permissionFile is not valid JSON', async () => {
    const file = path.join(tmp, '__bad.json');
    await fs.writeFile(file, '{ this is not json');
    try {
      await expect(
        resolvePermissions({ permissionFile: '__bad.json' }, tmp),
      ).rejects.toThrow(/not valid JSON/);
    } finally {
      await fs.unlink(file);
    }
  });

  it('throws when permissionFile is not an array of strings', async () => {
    const file = path.join(tmp, '__bad.json');
    await fs.writeFile(file, '{"not": "array"}');
    try {
      await expect(
        resolvePermissions({ permissionFile: '__bad.json' }, tmp),
      ).rejects.toThrow(/JSON array of strings/);
    } finally {
      await fs.unlink(file);
    }
  });

  it('throws when permissionFile exceeds size limit', async () => {
    const file = path.join(tmp, '__huge.json');
    // 2MB of content
    const buf = Buffer.alloc(2_000_000, 'a');
    await fs.writeFile(file, buf);
    try {
      await expect(
        resolvePermissions({ permissionFile: '__huge.json' }, tmp),
      ).rejects.toThrow(/exceeds/);
    } finally {
      await fs.unlink(file);
    }
  });
});
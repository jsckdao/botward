import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/skills/claude-code-compat.js';

describe('parseFrontMatter', () => {
  it('parses simple key-value pairs', () => {
    const { frontMatter, body } = parseFrontMatter(
      '---\nname: foo\ndescription: bar\n---\nbody text',
    );
    expect(frontMatter.name).toBe('foo');
    expect(frontMatter.description).toBe('bar');
    expect(body).toBe('body text');
  });

  it('returns empty front-matter when no delimiters', () => {
    const { frontMatter, body } = parseFrontMatter('just a body');
    expect(frontMatter).toEqual({});
    expect(body).toBe('just a body');
  });

  it('returns empty front-matter when only one delimiter', () => {
    const { frontMatter, body } = parseFrontMatter('---\nname: x\nno closing');
    expect(frontMatter).toEqual({});
    expect(body).toBe('---\nname: x\nno closing');
  });

  it('strips surrounding quotes from values', () => {
    const { frontMatter } = parseFrontMatter(
      '---\nname: "with quotes"\ndescription: \'single\'\n---\n',
    );
    expect(frontMatter.name).toBe('with quotes');
    expect(frontMatter.description).toBe('single');
  });
});
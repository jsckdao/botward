import { describe, expect, it } from 'vitest';
import { matchGlob } from '../../src/tools/builtin/matchers/glob.js';
import { matchUrl } from '../../src/tools/builtin/matchers/url.js';
import { matchCommand } from '../../src/tools/builtin/matchers/command.js';

describe('matchGlob', () => {
  it('matches * within a single segment', () => {
    expect(matchGlob('foo.txt', '*.txt')).toBe(true);
    expect(matchGlob('a/b/foo.txt', '*.txt')).toBe(false);
    expect(matchGlob('foo.ts', '*.txt')).toBe(false);
  });

  it('matches ** across path separators', () => {
    expect(matchGlob('a/b/c.txt', 'a/**/*.txt')).toBe(true);
    expect(matchGlob('a.txt', 'a/**/*.txt')).toBe(false);
  });

  it('matches ? as a single char', () => {
    expect(matchGlob('foo.txt', 'foo.?xt')).toBe(true);
    expect(matchGlob('fooxxt', 'foo.?xt')).toBe(false);
  });

  it('escapes regex meta chars', () => {
    expect(matchGlob('foo+bar.txt', 'foo+bar.txt')).toBe(true);
    expect(matchGlob('foo.bar.txt', 'foo.bar.txt')).toBe(true); // literal dot
    expect(matchGlob('fooxbar.txt', 'foo.bar.txt')).toBe(false);
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(matchGlob('a\\b\\c.txt', 'a/**/*.txt')).toBe(true);
  });
});

describe('matchUrl', () => {
  it('matches identical URLs', () => {
    expect(matchUrl('https://api.example.com/v1/x', 'https://api.example.com/v1/x')).toBe(true);
  });

  it('matches different protocols as different', () => {
    expect(matchUrl('http://api.example.com', 'https://api.example.com')).toBe(false);
  });

  it('matches host with leading *', () => {
    expect(matchUrl('https://api.example.com/foo', 'https://*.example.com/*')).toBe(true);
    expect(matchUrl('https://other.example.com/foo', 'https://*.example.com/*')).toBe(true);
    expect(matchUrl('https://example.com/foo', 'https://*.example.com/*')).toBe(false); // length differs
  });

  it('matches * host alone', () => {
    expect(matchUrl('https://anything.test/foo', 'https://*')).toBe(true);
  });

  it('matches path glob', () => {
    expect(matchUrl('https://api.example.com/v1/users/123', 'https://api.example.com/v1/**')).toBe(true);
    expect(matchUrl('https://api.example.com/v2/users', 'https://api.example.com/v1/**')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(matchUrl('not a url', 'https://example.com/*')).toBe(false);
    expect(matchUrl('https://example.com', 'also not a url')).toBe(false);
  });
});

describe('matchCommand', () => {
  it('matches exact command', () => {
    expect(matchCommand('git status', 'git status')).toBe(true);
    expect(matchCommand('git status', 'git log')).toBe(false);
  });

  it('matches with trailing args when pattern ends with *', () => {
    expect(matchCommand('git status', 'git *')).toBe(true);
    expect(matchCommand('git log --oneline', 'git *')).toBe(true);
    expect(matchCommand('npm install --save-dev', 'npm *')).toBe(true);
  });

  it('rejects commands with extra leading tokens', () => {
    expect(matchCommand('sudo git status', 'git *')).toBe(false);
  });

  it('rejects when input is shorter than pattern', () => {
    expect(matchCommand('git', 'git status')).toBe(false);
  });

  it('handles * in middle of pattern', () => {
    expect(matchCommand('python -m pytest tests/', 'python -m pytest *')).toBe(true);
    expect(matchCommand('python -m pytest', 'python -m pytest *')).toBe(false); // no trailing arg
  });

  it('rejects empty pattern', () => {
    expect(matchCommand('anything', '')).toBe(false);
  });
});
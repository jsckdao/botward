/**
 * Parse a minimal YAML-ish front-matter block from the top of a markdown file.
 * Format expected:
 *   ---
 *   name: foo
 *   description: bar
 *   ---
 *   (body follows)
 *
 * Only flat `key: value` pairs are supported — this is intentional, the goal
 * is to be compatible with Claude Code's SKILL.md files, not a full YAML
 * parser. Avoids the `gray-matter` dependency.
 */
export interface FrontMatter {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface ParsedSkillDoc {
  frontMatter: FrontMatter;
  body: string;
}

export function parseFrontMatter(raw: string): ParsedSkillDoc {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { frontMatter: {}, body: raw };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { frontMatter: {}, body: raw };
  }

  const fmLines = lines.slice(1, endIdx);
  const frontMatter: FrontMatter = {};
  for (const line of fmLines) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2] ?? '';
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontMatter[key] = value.trim();
  }

  const body = lines.slice(endIdx + 1).join('\n').trim();
  return { frontMatter, body };
}
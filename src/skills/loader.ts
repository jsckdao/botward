import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../utils/errors.js';
import { type SkillConfig } from '../config/schema.js';
import { resolveFromConfig } from '../config/paths.js';
import { parseFrontMatter } from './claude-code-compat.js';

export interface ResolvedSkill {
  name: string;
  description: string;
  /** Inlined text to inject into the system prompt. */
  content: string;
}

/**
 * Resolve all skills from the config. Two modes:
 *   - inline: `content` is used as-is
 *   - directory: `dir` points at a folder; we read SKILL.md (Claude Code
 *     convention), parse its front-matter, and use the body as content.
 *     The directory is otherwise treated as opaque — sibling files are not
 *     auto-loaded; the model can be told about them via the read-file tool.
 */
export async function loadSkills(
  configs: SkillConfig[],
  configDir: string,
): Promise<ResolvedSkill[]> {
  const skills: ResolvedSkill[] = [];
  for (const cfg of configs) {
    skills.push(await loadOneSkill(cfg, configDir));
  }
  return skills;
}

async function loadOneSkill(cfg: SkillConfig, configDir: string): Promise<ResolvedSkill> {
  // Inline mode
  if (cfg.content !== undefined) {
    return {
      name: cfg.name,
      description: cfg.description,
      content: cfg.content,
    };
  }

  // Directory mode
  if (cfg.dir === undefined) {
    // Schema refinement already enforces this; defensive.
    throw new BotwardError(`skill "${cfg.name}" has neither content nor dir`);
  }

  const absDir = resolveFromConfig(configDir, cfg.dir);
  const skillFile = path.join(absDir, 'SKILL.md');

  let raw: string;
  try {
    raw = await fs.readFile(skillFile, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BotwardError(
        `skill "${cfg.name}" directory "${absDir}" is missing SKILL.md`,
      );
    }
    throw new BotwardError(
      `failed to read SKILL.md for skill "${cfg.name}": ${(err as Error).message}`,
    );
  }

  const parsed = parseFrontMatter(raw);
  // Front-matter wins over JSON for both name and description when present.
  const name = parsed.frontMatter.name ?? cfg.name;
  const description = parsed.frontMatter.description ?? cfg.description;

  return { name, description, content: parsed.body };
}
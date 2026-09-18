import type { Config } from '../config/schema.js';
import type { ResolvedSkill } from '../skills/loader.js';

export interface ComposedPrompt {
  system: string;
  /** Names of the available tools, for the prompt footer. */
  toolNames: string[];
}

/**
 * Compose the system prompt from the config's `systemPrompt` + resolved
 * skills, with a brief footer listing the available tools.
 */
export function composeSystemPrompt(
  config: Config,
  skills: ResolvedSkill[],
  toolNames: string[],
): string {
  const sections: string[] = [];

  if (config.systemPrompt) {
    sections.push(config.systemPrompt.trim());
  }

  if (skills.length > 0) {
    const skillBlocks = skills
      .map((s) => {
        const header = `## Skill: ${s.name}`;
        const desc = s.description ? `\n${s.description}\n` : '';
        return `${header}${desc}\n${s.content.trim()}`;
      })
      .join('\n\n---\n\n');
    sections.push(`# Available skills\n\n${skillBlocks}`);
  }

  if (toolNames.length > 0) {
    sections.push(
      `# Available tools\n\n${toolNames.map((n) => `- ${n}`).join('\n')}`,
    );
  }

  return sections.join('\n\n').trim();
}
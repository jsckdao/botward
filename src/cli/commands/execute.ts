import { loadConfig } from '../../config/loader.js';
import { loadSkills } from '../../skills/loader.js';
import { loadTools } from '../../tools/loader.js';
import { createLLMClient } from '../../llm/factory.js';
import { composeSystemPrompt } from '../../agent/prompt.js';
import { runAgent } from '../../agent/loop.js';
import { logger } from '../../utils/logger.js';

export async function executeCommand(
  task: string,
  options: { config: string },
): Promise<void> {
  logger.info(`loading config: ${options.config}`);
  const { config, configDir } = await loadConfig(options.config);
  logger.info(`config "${config.name}" (provider=${config.provider})`);

  const skills = await loadSkills(config.skills, configDir);
  const tools = await loadTools(config.tools, configDir);

  const llm = createLLMClient(config);
  const system = composeSystemPrompt(
    config,
    skills,
    tools.map((t) => t.name),
  );

  const result = await runAgent(task, {
    llm,
    tools,
    config,
    system,
  });

  // Final assistant text goes to stdout — the whole point of execute.
  process.stdout.write(`${result.finalText}\n`);
}
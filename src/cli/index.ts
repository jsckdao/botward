#!/usr/bin/env node
import { Command } from 'commander';
import { executeCommand } from './commands/execute.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('botward')
  .description('A minimal single-task AI agent CLI')
  .version('0.1.0');

program
  .command('execute')
  .description('Run a single task and exit')
  .argument('<task>', 'Task description')
  .option('-c, --config <path>', 'Config file path', 'botward.json')
  .action(async (task: string, options: { config: string }) => {
    try {
      await executeCommand(task, options);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Generate a botward project from a free-form requirement via AI')
  .argument('<requirements>', 'Free-form description of the agent you want')
  .option(
    '-o, --output <path>',
    'Path for the main config file (its directory becomes the project root)',
    'botward.json',
  )
  .option('--provider <provider>', 'Force provider: anthropic | openai')
  .option('--model <model>', 'Override the model name')
  .action(
    async (
      requirements: string,
      options: { output: string; provider?: string; model?: string },
    ) => {
      try {
        await initCommand(requirements, options);
        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv);
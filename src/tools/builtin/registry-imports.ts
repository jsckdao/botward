// Side-effect module: ensures registry.ts is fully evaluated BEFORE any tool
// factory file calls registerBuiltin(). ESM imports are hoisted, so this file
// must import registry.js first to satisfy initialization order.
//
// Loader.ts imports this once. Every consumer that might trigger builtin
// resolution must go through the loader — never import registry.ts alone.
import './registry.js';
import './tools/read-file.js';
import './tools/write-file.js';
import './tools/list-files.js';
import './tools/search-files.js';
import './tools/fetch-url.js';
import './tools/run-command.js';
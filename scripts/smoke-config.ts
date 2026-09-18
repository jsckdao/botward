import { loadConfig } from '../src/config/loader.js';

const cfg = await loadConfig('tests/fixtures/basic.json');
console.log('configDir:', cfg.configDir);
console.log('name:', cfg.config.name);
console.log('provider:', cfg.config.provider);
console.log('skills:', cfg.config.skills.length);
console.log('tools:', cfg.config.tools.length);
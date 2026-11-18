'use strict';

const path = require('path');
const { readStdin, parseInput, filePathFrom, emit } = require('./lib/cursor-input');

const ALLOWED = new Set([
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
]);

async function main() {
  const input = parseInput(await readStdin());
  const filePath = filePathFrom(input);
  const base = path.basename(filePath);
  const blocked = /\.(md|txt)$/i.test(filePath) && !ALLOWED.has(base);
  if (!blocked) {
    emit({ permission: 'allow' });
    return;
  }
  emit({
    permission: 'deny',
    user_message: `Blocked new documentation file: ${filePath}`,
    agent_message:
      'Hook blocked creation of a .md or .txt file. ' +
      'Use README.md for documentation. Allowed names: ' +
      'README.md, CLAUDE.md, AGENTS.md, CONTRIBUTING.md.',
  });
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
});

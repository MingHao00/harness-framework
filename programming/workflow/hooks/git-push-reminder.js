'use strict';

const { readStdin, parseInput, commandFrom, emit } = require('../../harness-evolution/hooks/lib/cursor-input');

const PUSH_PATTERN = /(^|\s)git\s+push\b/;

async function main() {
  const input = parseInput(await readStdin());
  const command = commandFrom(input);
  if (!PUSH_PATTERN.test(command)) {
    emit({ permission: 'allow' });
    return;
  }
  emit({
    permission: 'allow',
    user_message: 'Review the changes before this git push. The push will continue.',
    agent_message: 'Hook: review changes before git push. Continuing with the push.',
  });
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
});

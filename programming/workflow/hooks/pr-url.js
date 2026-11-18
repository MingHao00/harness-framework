'use strict';

const { readStdin, parseInput, commandFrom, emit } = require('../../harness-evolution/hooks/lib/cursor-input');

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;

async function main() {
  const input = parseInput(await readStdin());
  const command = commandFrom(input);
  const output = outputText(input);
  if (!/gh\s+pr\s+create\b/.test(command)) {
    return;
  }
  const match = output.match(PR_URL);
  if (!match) {
    return;
  }
  const url = match[0];
  const repo = url.replace(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/, '$1');
  const number = url.replace(/.*\/pull\/(\d+)/, '$1');
  emit({
    additional_context:
      `PR created: ${url}\nTo review: gh pr review ${number} --repo ${repo}`,
  });
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function outputText(input) {
  const toolOutput = input.tool_output;
  if (typeof toolOutput === 'string') {
    return toolOutput;
  }
  if (toolOutput && typeof toolOutput === 'object') {
    const record = toolOutput;
    if (typeof record.output === 'string') {
      return record.output;
    }
  }
  if (typeof input.output === 'string') {
    return input.output;
  }
  return '';
}

main().catch(() => {
  process.exit(0);
});

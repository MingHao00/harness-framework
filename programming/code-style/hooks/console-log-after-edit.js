'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin, parseInput, filePathFrom, emit } = require('../../harness-evolution/hooks/lib/cursor-input');

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx']);
const MAX_MATCHES = 5;

async function main() {
  const input = parseInput(await readStdin());
  const filePath = filePathFrom(input);
  if (!filePath || !SOURCE_EXT.has(path.extname(filePath)) || !fs.existsSync(filePath)) {
    return;
  }
  const warning = consoleLogWarning(filePath, readMatches(filePath));
  if (warning) {
    emit({ additional_context: warning });
  }
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function readMatches(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const matches = [];
  lines.forEach((line, index) => {
    if (/console\.log/.test(line)) {
      matches.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return matches.slice(0, MAX_MATCHES);
}

/**
 * @param {string} filePath
 * @param {string[]} matches
 * @returns {string}
 */
function consoleLogWarning(filePath, matches) {
  if (!matches.length) {
    return '';
  }
  return [
    `[Hook] WARNING: console.log found in ${filePath}`,
    ...matches,
    '[Hook] Remove console.log before committing',
  ].join('\n');
}

module.exports = { consoleLogWarning };

if (require.main === module) {
  main().catch(() => {
    process.exit(0);
  });
}

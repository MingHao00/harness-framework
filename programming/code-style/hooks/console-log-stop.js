'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { emit } = require('../../harness-evolution/hooks/lib/cursor-input');

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx']);
const MAX_MATCHES = 5;

function main() {
  const files = changedSourceFiles();
  const notes = [];
  for (const filePath of files) {
    const matches = consoleMatches(filePath);
    if (!matches.length) {
      continue;
    }
    notes.push(`[Hook] WARNING: console.log found in ${filePath}`);
    notes.push(...matches);
  }
  if (notes.length) {
    notes.push('[Hook] Remove console.log before committing');
    emit({ additional_context: notes.join('\n') });
  }
}

/**
 * @returns {string[]}
 */
function changedSourceFiles() {
  let output = '';
  try {
    output = execSync('git diff --name-only HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    return [];
  }
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && SOURCE_EXT.has(path.extname(line)))
    .filter((line) => fs.existsSync(line));
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function consoleMatches(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const matches = [];
  lines.forEach((line, index) => {
    if (/console\.log/.test(line)) {
      matches.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return matches.slice(0, MAX_MATCHES);
}

main();

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdin, parseInput, filePathFrom, emit } = require('../../harness-evolution/hooks/lib/cursor-input');

const MAX_LINES = 10;

async function main() {
  const input = parseInput(await readStdin());
  const message = typecheckMessage(filePathFrom(input), runTsc);
  if (message) {
    emit({ additional_context: message });
  }
}

/**
 * 只保留和当前文件有关的 tsc 输出。运行器可替换，测试不必启动 npx。
 *
 * @param {string} filePath
 * @param {(projectDir: string) => { stdout?: string, stderr?: string }} runTsc
 * @returns {string}
 */
function typecheckMessage(filePath, runTsc) {
  if (!isTypeScriptSource(filePath)) {
    return '';
  }
  const projectDir = findTsconfigDir(path.resolve(filePath));
  if (!projectDir) {
    return '';
  }
  return relatedLines(filePath, runTsc(projectDir));
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isTypeScriptSource(filePath) {
  return Boolean(filePath) && /\.tsx?$/.test(filePath) && fs.existsSync(filePath);
}

/**
 * @param {string} filePath
 * @param {{ stdout?: string, stderr?: string }} result
 * @returns {string}
 */
function relatedLines(filePath, result) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const name = path.basename(filePath);
  return combined
    .split('\n')
    .filter((line) => line.includes(filePath) || line.includes(name))
    .slice(0, MAX_LINES)
    .join('\n');
}

/**
 * @param {string} projectDir
 * @returns {{ stdout?: string, stderr?: string }}
 */
function runTsc(projectDir) {
  return spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: projectDir,
    encoding: 'utf8',
    shell: true,
  });
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function findTsconfigDir(filePath) {
  let dir = path.dirname(filePath);
  const stop = path.parse(dir).root;
  while (dir && dir !== stop) {
    if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return '';
}

if (require.main === module) {
  main().catch(() => {
    process.exit(0);
  });
}

module.exports = { typecheckMessage, findTsconfigDir };

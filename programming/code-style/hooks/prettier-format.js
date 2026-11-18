'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdin, parseInput, filePathFrom } = require('../../harness-evolution/hooks/lib/cursor-input');

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx']);
const CONFIG_NAMES = [
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.js',
  '.prettierrc.cjs',
];

async function main() {
  const input = parseInput(await readStdin());
  formatEditedFile(filePathFrom(input));
}

/**
 * 只在源码文件且项目配置了 Prettier 时格式化。测试可替换运行器，避免调用 npx。
 *
 * @param {string} filePath
 * @param {(root: string, target: string) => void} [runFormat]
 * @returns {boolean}
 */
function formatEditedFile(filePath, runFormat = formatWithPrettier) {
  const root = prettierRoot(filePath);
  if (!root) {
    return false;
  }
  runFormat(root, filePath);
  return true;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function prettierRoot(filePath) {
  if (!filePath || !SOURCE_EXT.has(path.extname(filePath))) {
    return '';
  }
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const root = findProjectRoot(filePath);
  if (!root || !hasPrettier(root)) {
    return '';
  }
  return root;
}

/**
 * @param {string} root
 * @param {string} target
 */
function formatWithPrettier(root, target) {
  spawnSync('npx', ['prettier', '--write', target], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: 'ignore',
  });
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function findProjectRoot(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  const stop = path.parse(dir).root;
  while (dir && dir !== stop) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return '';
}

/**
 * @param {string} root
 * @returns {boolean}
 */
function hasPrettier(root) {
  if (CONFIG_NAMES.some((name) => fs.existsSync(path.join(root, name)))) {
    return true;
  }
  const packagePath = path.join(root, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return Boolean(pkg.prettier);
  } catch (error) {
    return false;
  }
}

if (require.main === module) {
  main().catch(() => {
    process.exit(0);
  });
}

module.exports = { formatEditedFile, findProjectRoot, hasPrettier };

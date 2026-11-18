'use strict'

const { spawnSync } = require('child_process')

/**
 * @param {string} script
 * @param {{ args?: string[], input?: string, cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runNode(script, options = {}) {
  const args = options.args || []
  return spawnSync(process.execPath, [script, ...args], {
    input: options.input,
    encoding: 'utf8',
    cwd: options.cwd,
    env: options.env || process.env,
    windowsHide: true,
  })
}

/**
 * 子进程使用单独的用户目录，避免测试写进真实的主目录。
 *
 * @param {string} home
 * @param {NodeJS.ProcessEnv} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
function isolatedEnv(home, extra = {}) {
  const env = { ...process.env, USERPROFILE: home, HOME: home }
  delete env.CLAUDE_PACKAGE_MANAGER
  return { ...env, ...extra }
}

module.exports = { runNode, isolatedEnv }

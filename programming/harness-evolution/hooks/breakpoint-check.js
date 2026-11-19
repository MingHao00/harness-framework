'use strict'

const fs = require('fs/promises')
const path = require('path')
const { spawnSync } = require('child_process')
const { redactSecrets } = require('./redact')
const { CHECK_UNCONFIGURED } = require('./breakpoint-text')

const MAKEFILE_NAMES = ['Makefile', 'makefile', 'GNUmakefile']
const CHECK_TARGET = /^check:/m
const CHECK_PASSED = '检查通过'
const CHECK_FAILED = '检查失败'
const CHECK_TIMEOUT = '检查超时'
const MAKE_CHECK_TIMEOUT_MS = 30000
const CHECK_OUTPUT_LIMIT = 500
const MAKE_COMMAND = 'make'
const MAKE_TASK = 'check'

/**
 * 有 check 目标才跑。没有 Makefile 时不调用 make。
 *
 * @param {string} repoRoot 仓库根
 * @param {(repoRoot: string) => Promise<{ status: string }>} [runCheck] 测试可替换
 * @returns {Promise<string>} 写入检查栏的文字
 */
async function loadCheckStatus(repoRoot, runCheck) {
  const configured = await makefileHasCheck(repoRoot)
  if (!configured) return CHECK_UNCONFIGURED
  try {
    const result = await (runCheck || runMakeCheck)(repoRoot)
    return result && result.status ? result.status : CHECK_FAILED
  } catch (error) {
    const message = redactSecrets(error && error.message ? error.message : CHECK_FAILED)
    return `${CHECK_FAILED}\n${message}`
  }
}

/**
 * 跑 make check。失败和超时都变成检查栏文字，不向外抛。
 *
 * @param {string} repoRoot 仓库根
 * @returns {{ status: string }} 检查栏文字
 */
function runMakeCheck(repoRoot) {
  const result = spawnSync(MAKE_COMMAND, [MAKE_TASK], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: MAKE_CHECK_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error && (result.error.code === 'ETIMEDOUT' || result.signal)) {
    return { status: CHECK_TIMEOUT }
  }
  if (result.error) {
    const message = redactSecrets(result.error.message || CHECK_FAILED)
    return { status: `${CHECK_FAILED}\n${message}` }
  }
  if (result.status === 0) return { status: CHECK_PASSED }
  return { status: failedStatus(result.stdout, result.stderr) }
}

async function makefileHasCheck(repoRoot) {
  for (const name of MAKEFILE_NAMES) {
    const text = await readOptional(path.join(repoRoot, name))
    if (text && CHECK_TARGET.test(text)) return true
  }
  return false
}

function failedStatus(stdout, stderr) {
  const tail = redactSecrets(`${stdout || ''}\n${stderr || ''}`).trim()
  const clipped = tail.slice(-CHECK_OUTPUT_LIMIT)
  if (!clipped) return CHECK_FAILED
  return `${CHECK_FAILED}\n${clipped}`
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

module.exports = {
  loadCheckStatus,
  runMakeCheck,
}

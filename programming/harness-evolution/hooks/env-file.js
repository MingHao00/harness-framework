'use strict'

const fs = require('fs')
const path = require('path')
const {
  ALLOWED_ENV_KEYS,
  ENV_FILE_NAME,
  EXPORT_PREFIX,
  QUOTE_WRAP_MIN,
} = require('./constants')

/**
 * 只补齐 Hook 用到的变量。已有环境变量优先，避免 .env 盖过调用方。
 *
 * @param {string} repoRoot 仓库根
 * @param {NodeJS.ProcessEnv} env 可写的环境对象
 * @returns {void}
 */
function loadEnvFile(repoRoot, env) {
  let text = ''
  try {
    text = fs.readFileSync(path.join(repoRoot, ENV_FILE_NAME), 'utf8')
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) applyEnvLine(env, line)
}

function applyEnvLine(env, line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const body = trimmed.startsWith(EXPORT_PREFIX)
    ? trimmed.slice(EXPORT_PREFIX.length)
    : trimmed
  const splitAt = body.indexOf('=')
  if (splitAt <= 0) return
  const key = body.slice(0, splitAt).trim()
  if (!ALLOWED_ENV_KEYS.includes(key) || env[key]) return
  env[key] = stripQuotes(body.slice(splitAt + 1).trim())
}

function stripQuotes(value) {
  const quoted = value.length >= QUOTE_WRAP_MIN
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))
  if (!quoted) return value
  return value.slice(1, -1)
}

module.exports = { loadEnvFile }

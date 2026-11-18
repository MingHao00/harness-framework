#!/usr/bin/env node
'use strict'

const { pickRepoRoot } = require('./session-flow')
const { handleHook } = require('./dispatch')
const { loadEnvFile } = require('./env-file')
const { completeChat } = require('./model-client')
const { sendWindowsNotification } = require('./notify')
const { redactSecrets } = require('./redact')

/**
 * 失败也退出 0。关窗口时 sessionEnd 可能根本跑不起来。
 *
 * @returns {Promise<void>}
 */
async function main() {
  if (process.argv.includes('--flush')) {
    await flushPendingNow()
    return
  }
  const env = { ...process.env }
  const input = await readHookInput()
  const repoRoot = pickRepoRoot(input, process.cwd())
  loadEnvFile(repoRoot, env)
  const result = await handleHook(input, hookOptions(repoRoot, env))
  if (result && result.continue === true) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`)
  }
}

async function flushPendingNow() {
  const env = { ...process.env }
  const repoRoot = pickRepoRoot({ workspace_roots: [process.cwd()] }, process.cwd())
  loadEnvFile(repoRoot, env)
  const result = await handleHook({
    hook_event_name: 'workspaceOpen',
    workspace_roots: [repoRoot],
  }, hookOptions(repoRoot, env))
  process.stdout.write(`${result.status}\n`)
}

function hookOptions(repoRoot, env) {
  return {
    repoRoot,
    env,
    completeChat,
    notify: sendWindowsNotification,
  }
}

async function readHookInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : '未知失败'
  process.stderr.write(`session-record: ${redactSecrets(message)}\n`)
}).finally(() => {
  process.exit(0)
})

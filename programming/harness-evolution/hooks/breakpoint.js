#!/usr/bin/env node
'use strict'

const { pickRepoRoot } = require('./session-flow')
const { loadEnvFile } = require('./env-file')
const { completeChat } = require('./model-client')
const { redactSecrets } = require('./redact')
const { runBreakpoint } = require('./breakpoint-flow')

/**
 * 断点钩子失败也退出 0，避免挡住压缩、开场和工具。
 *
 * @returns {Promise<void>}
 */
async function main() {
  const env = { ...process.env }
  const input = await readHookInput()
  const repoRoot = pickRepoRoot(input, process.cwd())
  loadEnvFile(repoRoot, env)
  const result = await runBreakpoint(input || {}, {
    repoRoot,
    env,
    completeChat,
  })
  if (result && result.additional_context) {
    process.stdout.write(JSON.stringify({ additional_context: result.additional_context }))
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
    return {}
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : '未知失败'
  process.stderr.write(`breakpoint: ${redactSecrets(message)}\n`)
}).finally(() => {
  process.exit(0)
})

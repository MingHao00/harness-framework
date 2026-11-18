'use strict'

const fs = require('fs')
const { runSessionRecord } = require('./session-flow')
const { resolveTranscriptPath } = require('./transcript')
const { upsertPending, removePending, listPending } = require('./pending')
const { FLUSH_BUDGET_MS, FLUSH_PROMPT } = require('./constants')

const STOP_EVENT = 'stop'
const START_EVENT = 'sessionStart'
const OPEN_EVENT = 'workspaceOpen'
const PROMPT_EVENT = 'beforeSubmitPrompt'

/**
 * 按 Hook 事件分流。stop 只记待处理；关窗口写不了时，下次再补。
 *
 * @param {object | null} input Hook 的 stdin JSON
 * @param {object} options 仓库、环境和可替换的模型
 * @returns {Promise<{ status: string }>}
 */
async function handleHook(input, options) {
  // 解析失败时 stdin 不是对象。当成 sessionEnd 会往 log/errors 写 missing1。
  if (!isHookPayload(input)) return { status: 'ignored' }
  const event = eventName(input)
  if (event === STOP_EVENT) return rememberStop(input, options)
  if (event === START_EVENT) {
    return flushPending(options, sessionIdOf(input))
  }
  if (event === OPEN_EVENT) return flushPending(options, '')
  if (event === PROMPT_EVENT) return flushOnRequest(input, options)
  return finishSession(input, options)
}

async function flushOnRequest(input, options) {
  const prompt = input && typeof input.prompt === 'string' ? input.prompt : ''
  if (!prompt.includes(FLUSH_PROMPT)) return { status: 'ignored', continue: true }
  await rememberStop(input, options)
  const flushed = await flushPending(options, '')
  return { ...flushed, continue: true }
}

async function rememberStop(input, options) {
  const sessionId = sessionIdOf(input)
  const transcriptPath = resolveTranscriptPath(input, options.env, fileIo())
  if (!sessionId || !transcriptPath) return { status: 'pending-skipped' }
  await upsertPending(options.repoRoot, sessionId, transcriptPath)
  return { status: 'pending' }
}

async function finishSession(input, options) {
  const result = await runSessionRecord(input, options)
  const sessionId = sessionIdOf(input)
  if (sessionId) await removePending(options.repoRoot, sessionId)
  return result
}

async function flushPending(options, skipSessionId) {
  const started = Date.now()
  const entries = await listPending(options.repoRoot)
  for (const entry of entries) {
    if (entry.sessionId === skipSessionId) continue
    if (Date.now() - started > FLUSH_BUDGET_MS) return { status: 'flush-partial' }
    await finishSession(stoppedInput(entry), options)
  }
  return { status: 'flushed' }
}

function stoppedInput(entry) {
  return {
    session_id: entry.sessionId,
    conversation_id: entry.sessionId,
    transcript_path: entry.transcriptPath,
    hook_event_name: 'sessionEnd',
  }
}

function fileIo() {
  return { exists: (filePath) => fs.existsSync(filePath), userProfile: '' }
}

function isHookPayload(input) {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function eventName(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'sessionEnd'
  const name = input.hook_event_name
  return typeof name === 'string' && name.trim() ? name.trim() : 'sessionEnd'
}

function sessionIdOf(input) {
  if (!input || typeof input !== 'object') return ''
  if (typeof input.session_id === 'string' && input.session_id.trim()) {
    return input.session_id.trim()
  }
  if (typeof input.conversation_id === 'string' && input.conversation_id.trim()) {
    return input.conversation_id.trim()
  }
  return ''
}

module.exports = { handleHook }

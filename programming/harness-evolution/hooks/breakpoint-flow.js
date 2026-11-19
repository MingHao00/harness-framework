'use strict'

const fsSync = require('fs')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { randomBytes } = require('crypto')
const { toShortId } = require('./short-id')
const { MISSING_SHORT_ID } = require('./constants')
const { resolveTranscriptPath, readPreparedTranscript } = require('./transcript')
const { loadCheckStatus } = require('./breakpoint-check')
const {
  BREAKPOINT_SYSTEM,
  buildBreakpointPrompt,
  parseBreakpointReply,
  renderBreakpoint,
  replaceCheckSection,
  hashTranscript,
} = require('./breakpoint-text')

const EVENT_PRE_COMPACT = 'preCompact'
const EVENT_SESSION_END = 'sessionEnd'
const EVENT_SESSION_START = 'sessionStart'
const EVENT_POST_TOOL = 'postToolUse'
const NOW_DIR = 'now'

/**
 * 按钩子事件写断点或注入已有断点。失败时不抛出，避免挡住压缩和工具。
 *
 * @param {object} input Cursor 钩子输入
 * @param {object} options 仓库、模型和检查命令
 * @returns {Promise<{ status: string, additional_context?: string }>}
 */
async function runBreakpoint(input, options) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const shortId = toShortId(firstText(source.session_id, source.conversation_id))
  if (!isUsableShortId(shortId)) return { status: 'skipped' }
  const event = source.hook_event_name
  if (event === EVENT_SESSION_START) return injectExisting(options, shortId)
  if (event === EVENT_POST_TOOL) return injectOnce(options.repoRoot, shortId)
  if (event === EVENT_PRE_COMPACT) return writeIfNeeded(source, options, shortId, true)
  if (event === EVENT_SESSION_END) return writeIfNeeded(source, options, shortId, false)
  return { status: 'ignored' }
}

async function injectExisting(options, shortId) {
  const filePath = breakpointPath(options.repoRoot, shortId)
  const current = await readOptional(filePath)
  if (!current) return { status: 'empty' }
  const checkStatus = await loadCheckStatus(options.repoRoot, options.runCheck)
  const next = replaceCheckSection(current, checkStatus)
  if (next !== current) await fs.writeFile(filePath, next, 'utf8')
  await fs.rm(injectPath(options.repoRoot, shortId), { force: true })
  return { status: 'injected', additional_context: next }
}

async function injectOnce(repoRoot, shortId) {
  const claim = await claimInject(repoRoot, shortId)
  if (!claim) return { status: 'idle' }
  const text = await readOptional(breakpointPath(repoRoot, shortId))
  await fs.rm(claim, { force: true })
  if (!text.trim()) return { status: 'idle' }
  return { status: 'injected', additional_context: text }
}

async function writeIfNeeded(input, options, shortId, leaveInject) {
  const prepared = await loadPrepared(input, options)
  if (!prepared) return { status: 'kept' }
  const hash = hashTranscript(prepared)
  const stamp = await readOptional(stampPath(options.repoRoot, shortId))
  const checkStatus = await loadCheckStatus(options.repoRoot, options.runCheck)
  const filePath = breakpointPath(options.repoRoot, shortId)
  if (stamp.trim() === hash && await readOptional(filePath)) {
    await refreshSaved(options.repoRoot, shortId, checkStatus, leaveInject)
    return { status: 'fresh' }
  }
  const fields = await askModel(prepared, options)
  if (!fields) {
    if (leaveInject && await readOptional(filePath)) {
      await markInject(options.repoRoot, shortId)
    }
    return { status: 'kept' }
  }
  await saveSnapshot(options.repoRoot, shortId, fields, checkStatus, hash, leaveInject)
  return { status: 'written' }
}

async function refreshSaved(repoRoot, shortId, checkStatus, leaveInject) {
  const filePath = breakpointPath(repoRoot, shortId)
  const current = await readOptional(filePath)
  const next = replaceCheckSection(current, checkStatus)
  if (next !== current) await fs.writeFile(filePath, next, 'utf8')
  if (leaveInject) await markInject(repoRoot, shortId)
}

async function saveSnapshot(repoRoot, shortId, fields, checkStatus, hash, leaveInject) {
  await fs.mkdir(nowDir(repoRoot), { recursive: true })
  const body = renderBreakpoint(fields, checkStatus)
  await fs.writeFile(breakpointPath(repoRoot, shortId), body, 'utf8')
  await fs.writeFile(stampPath(repoRoot, shortId), hash, 'utf8')
  if (leaveInject) await markInject(repoRoot, shortId)
}

async function askModel(prepared, options) {
  if (typeof options.completeChat !== 'function') return null
  try {
    const raw = await options.completeChat({
      env: options.env || {},
      system: BREAKPOINT_SYSTEM,
      prompt: buildBreakpointPrompt(prepared),
    })
    return parseBreakpointReply(raw)
  } catch {
    return null
  }
}

async function loadPrepared(input, options) {
  const io = options.io || defaultIo(options.env)
  const transcriptPath = resolveTranscriptPath(input, options.env || {}, io)
  if (!transcriptPath) return ''
  try {
    const prepared = await readPreparedTranscript(transcriptPath)
    return prepared.trim() ? prepared : ''
  } catch {
    return ''
  }
}

/**
 * 先改名占住标记。只有一个工具钩子能改名成功。
 *
 * @param {string} repoRoot 仓库根
 * @param {string} shortId 对话短号
 * @returns {string} 占住的路径；没有标记时为空
 */
function claimInject(repoRoot, shortId) {
  const marker = injectPath(repoRoot, shortId)
  const claim = `${marker}.${process.pid}.${randomBytes(4).toString('hex')}`
  try {
    // 异步改名会进线程池，Windows 上两次可能同时成功。同步改名让同一次只放行一个。
    fsSync.renameSync(marker, claim)
    return claim
  } catch {
    return ''
  }
}

async function markInject(repoRoot, shortId) {
  await fs.mkdir(nowDir(repoRoot), { recursive: true })
  await fs.writeFile(injectPath(repoRoot, shortId), '', 'utf8')
}

function nowDir(repoRoot) {
  return path.join(repoRoot, 'log', NOW_DIR)
}

function breakpointPath(repoRoot, shortId) {
  return path.join(nowDir(repoRoot), `${shortId}.md`)
}

function stampPath(repoRoot, shortId) {
  return path.join(nowDir(repoRoot), `${shortId}.stamp`)
}

function injectPath(repoRoot, shortId) {
  return path.join(nowDir(repoRoot), `${shortId}.inject`)
}

function isUsableShortId(shortId) {
  return shortId && shortId !== MISSING_SHORT_ID
}

function firstText(sessionId, conversationId) {
  if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim()
  if (typeof conversationId === 'string' && conversationId.trim()) return conversationId.trim()
  return ''
}

function defaultIo(env) {
  const userProfile = env && env.USERPROFILE ? env.USERPROFILE : os.homedir()
  return { exists: (filePath) => fsSync.existsSync(filePath), userProfile }
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

module.exports = { runBreakpoint }

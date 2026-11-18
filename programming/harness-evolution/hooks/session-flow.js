'use strict'

const os = require('os')
const fs = require('fs')
const { toShortId } = require('./short-id')
const { formatBeijingMinute } = require('./time')
const { redactSecrets } = require('./redact')
const { resolveTranscriptPath, readPreparedTranscript } = require('./transcript')
const { buildUserPrompt } = require('./prompt')
const { parseModelSummary, redactSummary } = require('./summary')
const { SessionRecordError } = require('./errors')
const {
  sessionAlreadyRecorded,
  readCurrentDecisionLines,
  persistRecords,
  writeErrorReport,
} = require('./write-records')
const {
  FAIL_NO_TRANSCRIPT,
  FAIL_BAD_INPUT,
  NOTIFY_TITLE,
  WINDOWS_DRIVE_PREFIX,
} = require('./constants')

/**
 * 对话结束后写工作日志和决策。没有实际工作不算失败。
 *
 * @param {object | null} input Hook 的 stdin JSON；无法解析时为 null
 * @param {object} options 仓库、环境、时钟和可替换的模型与通知
 * @param {string} options.repoRoot 仓库根
 * @param {NodeJS.ProcessEnv} options.env 环境变量
 * @param {Date} [options.now] 写入时间
 * @param {(request: { env: NodeJS.ProcessEnv, prompt: string }) => Promise<string>} options.completeChat
 * @param {(title: string, message: string) => Promise<unknown>} [options.notify]
 * @param {{ exists: (filePath: string) => boolean, userProfile: string }} [options.io]
 * @param {(filePath: string, encoding: string) => Promise<string>} [options.readFile]
 *   读取当天工作日志。默认读磁盘；测试用来注入读失败
 * @returns {Promise<{ status: string, reason?: string, decisionPath?: string }>}
 */
async function runSessionRecord(input, options) {
  const context = createContext(input, options)
  try {
    const seen = await sessionAlreadyRecorded(
      context.repoRoot,
      context.stamp.date,
      context.shortId,
      options.readFile,
    )
    if (seen) return { status: 'duplicate' }
    const summary = await summarizeSession(context)
    if (!summary.hasWork) return { status: 'no-work' }
    const decisionPath = await persistRecords(context.repoRoot, {
      ...summary,
      date: context.stamp.date,
      minute: context.stamp.minute,
      shortId: context.shortId,
    })
    return { status: 'written', decisionPath }
  } catch (error) {
    return reportFailure(context, error)
  }
}

/**
 * 多根工作区时写入 Hook 传入的第一个根，否则用当前目录。
 *
 * @param {object | null} input Hook 输入
 * @param {string} cwd 进程当前目录
 * @returns {string} 仓库根
 */
function pickRepoRoot(input, cwd) {
  const roots = input && Array.isArray(input.workspace_roots) ? input.workspace_roots : []
  const first = roots.find((item) => typeof item === 'string' && item.trim())
  return normalizeRepoRoot(first ? first.trim() : cwd)
}

function normalizeRepoRoot(root) {
  const matched = String(root || '').match(WINDOWS_DRIVE_PREFIX)
  if (!matched) return root
  // Cursor 在 Windows 上会多给一个前导斜杠，Node 会把它拼到错误的盘符路径。
  const rest = matched[2].replace(/^[\\/]+/, '').replace(/\//g, '\\')
  const drive = `${matched[1].toUpperCase()}:\\`
  return rest ? `${drive}${rest}` : drive
}

function createContext(input, options) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    input: source,
    repoRoot: options.repoRoot,
    env: options.env || {},
    stamp: formatBeijingMinute(options.now || new Date()),
    shortId: toShortId(firstText(source.session_id, source.conversation_id)),
    completeChat: options.completeChat,
    notify: options.notify,
    io: options.io || defaultIo(options.env),
    invalidInput: !input || typeof input !== 'object' || Array.isArray(input),
  }
}

function defaultIo(env) {
  const userProfile = env && env.USERPROFILE ? env.USERPROFILE : os.homedir()
  return { exists: (filePath) => fs.existsSync(filePath), userProfile }
}

function firstText(sessionId, conversationId) {
  if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim()
  if (typeof conversationId === 'string' && conversationId.trim()) return conversationId.trim()
  return ''
}

async function summarizeSession(context) {
  if (context.invalidInput) throw new SessionRecordError(FAIL_BAD_INPUT)
  const transcriptPath = resolveTranscriptPath(context.input, context.env, context.io)
  if (!transcriptPath) throw new SessionRecordError(FAIL_NO_TRANSCRIPT)
  const transcript = await readPreparedTranscript(transcriptPath)
  // 文件在，但没有 type 为 text 的内容。这不是找不到转录。
  if (!transcript.trim()) return { hasWork: false }
  const currentLines = await readCurrentDecisionLines(context.repoRoot)
  const raw = await context.completeChat({
    env: context.env,
    prompt: buildUserPrompt(transcript, currentLines),
  })
  return redactSummary(parseModelSummary(raw))
}

async function reportFailure(context, error) {
  const reason = publicReason(error)
  try {
    await writeErrorReport(context.repoRoot, {
      date: context.stamp.date,
      minute: context.stamp.minute,
      shortId: context.shortId,
      reason,
    })
  } catch {
    // 错误文件写失败时仍要打一行并通知，不能再抛出去。
  }
  process.stderr.write(`session-record: ${reason}\n`)
  await notifySafely(context.notify, reason)
  return { status: 'failed', reason }
}

function publicReason(error) {
  if (error instanceof SessionRecordError && error.reason) return redactSecrets(error.reason)
  const message = error && error.message ? error.message : '未知失败'
  return redactSecrets(message)
}

async function notifySafely(notify, reason) {
  if (typeof notify !== 'function') return
  try {
    await notify(NOTIFY_TITLE, reason)
  } catch {
    // 通知失败不能让 sessionEnd 变成非零退出。
  }
}

module.exports = { runSessionRecord, pickRepoRoot }

'use strict'

const fs = require('fs/promises')
const path = require('path')
const { redactSecrets } = require('./redact')
const { SessionRecordError } = require('./errors')
const {
  MAX_TRANSCRIPT_CHARS,
  PROJECT_TRANSCRIPT_SLUG,
  TRANSCRIPT_ENV_NAME,
  CONVERSATION_ID_PATTERN,
  FAIL_NO_TRANSCRIPT,
} = require('./constants')

/**
 * 按优先级找出存在的转录。给定路径不存在时继续往后找。
 *
 * @param {object} input Hook 输入
 * @param {NodeJS.ProcessEnv} env 进程环境
 * @param {{ exists: (filePath: string) => boolean, userProfile: string }} io 文件存在性
 * @returns {string | null} 找到的路径；都没有则为 null
 */
function resolveTranscriptPath(input, env, io) {
  const candidates = []
  pushPath(candidates, input && input.transcript_path)
  pushPath(candidates, env && env[TRANSCRIPT_ENV_NAME])
  const fallback = pathByConversation(input, io.userProfile)
  if (fallback) candidates.push(fallback)
  return candidates.find((filePath) => io.exists(filePath)) || null
}

/**
 * 从 JSONL 抽出 text，脱敏后只保留末尾。
 *
 * @param {string} jsonl 转录原文
 * @returns {string} 可发给模型的文本
 */
function prepareTranscript(jsonl) {
  return truncateTail(redactSecrets(extractText(jsonl)), MAX_TRANSCRIPT_CHARS)
}

/**
 * 过长时丢掉头部。结尾才是这次对话收束时的结论。
 *
 * @param {string} text 已脱敏文本
 * @param {number} maxChars 保留的字符数
 * @returns {string} 不超过 maxChars 的末尾
 */
function truncateTail(text, maxChars) {
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

/**
 * 读取转录并整理。读不到文件时当作找不到转录。
 *
 * @param {string} filePath 转录路径
 * @returns {Promise<string>} 整理后的文本
 * @throws {SessionRecordError} 文件无法读取
 */
async function readPreparedTranscript(filePath) {
  try {
    const jsonl = await fs.readFile(filePath, 'utf8')
    return prepareTranscript(jsonl)
  } catch (error) {
    if (error instanceof SessionRecordError) throw error
    throw new SessionRecordError(FAIL_NO_TRANSCRIPT)
  }
}

function pushPath(candidates, value) {
  if (typeof value === 'string' && value.trim()) candidates.push(value.trim())
}

function pathByConversation(input, userProfile) {
  const conversationId = firstConversationId(input)
  if (!conversationId || !userProfile) return null
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) return null
  return path.join(
    userProfile,
    '.cursor',
    'projects',
    PROJECT_TRANSCRIPT_SLUG,
    'agent-transcripts',
    conversationId,
    `${conversationId}.jsonl`,
  )
}

function firstConversationId(input) {
  if (!input) return ''
  if (typeof input.session_id === 'string' && input.session_id.trim()) {
    return input.session_id.trim()
  }
  if (typeof input.conversation_id === 'string' && input.conversation_id.trim()) {
    return input.conversation_id.trim()
  }
  return ''
}

function extractText(jsonl) {
  const blocks = []
  for (const line of String(jsonl || '').split(/\r?\n/)) {
    const block = textBlock(line)
    if (block) blocks.push(block)
  }
  return blocks.join('\n\n')
}

function textBlock(line) {
  if (!line.trim()) return ''
  const row = parseRow(line)
  if (!row) return ''
  const texts = textParts(row)
  if (!texts.length) return ''
  const role = typeof row.role === 'string' ? row.role : 'unknown'
  return `${role}: ${texts.join('\n')}`
}

function parseRow(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function textParts(row) {
  const content = row && row.message && row.message.content
  if (!Array.isArray(content)) return []
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
}

module.exports = {
  resolveTranscriptPath,
  prepareTranscript,
  truncateTail,
  readPreparedTranscript,
}

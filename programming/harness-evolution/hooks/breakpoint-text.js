'use strict'

const { createHash } = require('crypto')
const { redactSecrets } = require('./redact')
const { SessionRecordError } = require('./errors')
const { EMPTY_FIELD, FAIL_BAD_MODEL, FENCE_PATTERN } = require('./constants')

const CHECK_HEADING = '## 检查'
const CHECK_UNCONFIGURED = '检查尚未配置'
const BREAKPOINT_SYSTEM = [
  '你是 Harness 的断点记录员。只返回一个 JSON 对象，不要 Markdown，不要解释。',
  '字段必须齐全：stopped, dialogueVerification, knownIssues, nextSteps。',
  'stopped 写现在停在哪。dialogueVerification 写对话里已经出现的测试或 lint 结果。',
  'knownIssues 写已知问题。nextSteps 写下一步。',
  '没有的文字字段用空字符串。用短句，不抄对话原文，不写密钥、令牌或 Bearer。',
].join('\n')

/**
 * 发给断点模型的用户消息。转录在调用前已经脱敏。
 *
 * @param {string} transcript 整理后的转录
 * @returns {string} 用户提示
 */
function buildBreakpointPrompt(transcript) {
  return `下面是本次对话转录（只含文本，已脱敏，过长时只保留末尾）：\n${transcript}`
}

/**
 * 把模型回复收成四栏。非法 JSON 抛出，让调用方保留旧断点。
 *
 * @param {string} raw 模型正文
 * @returns {object} stopped、dialogueVerification、knownIssues、nextSteps
 * @throws {SessionRecordError} 不是 JSON 对象
 */
function parseBreakpointReply(raw) {
  const data = parseJsonObject(raw)
  return {
    stopped: fieldText(data.stopped),
    dialogueVerification: fieldText(data.dialogueVerification),
    knownIssues: fieldText(data.knownIssues),
    nextSteps: fieldText(data.nextSteps),
  }
}

/**
 * 断点正文。检查栏由钩子填写，不来自模型。
 *
 * @param {object} fields 四栏文字
 * @param {string} checkStatus 检查结果
 * @returns {string} Markdown
 */
function renderBreakpoint(fields, checkStatus) {
  return [
    '# 断点',
    '',
    '## 现在停在哪',
    fields.stopped,
    '',
    '## 对话里的验证',
    fields.dialogueVerification,
    '',
    '## 已知问题',
    fields.knownIssues,
    '',
    '## 下一步',
    fields.nextSteps,
    '',
    CHECK_HEADING,
    checkStatus,
    '',
  ].join('\n')
}

/**
 * 只替换检查栏，保留模型写过的其余栏目。
 *
 * @param {string} markdown 现有断点
 * @param {string} checkStatus 新的检查结果
 * @returns {string} 替换后的正文
 */
function replaceCheckSection(markdown, checkStatus) {
  const lines = String(markdown || '').split(/\r?\n/)
  const start = lines.reduce((found, line, index) => (
    line === CHECK_HEADING ? index : found
  ), -1)
  if (start < 0) {
    const trimmed = String(markdown || '').replace(/\s*$/, '')
    return `${trimmed}\n\n${CHECK_HEADING}\n${checkStatus}\n`
  }
  const nextHeading = lines.findIndex((line, index) => (
    index > start && line.startsWith('## ')
  ))
  const end = nextHeading < 0 ? lines.length : nextHeading
  const merged = [
    ...lines.slice(0, start),
    CHECK_HEADING,
    checkStatus,
    ...lines.slice(end),
  ]
  return `${merged.join('\n').replace(/\s*$/, '')}\n`
}

/**
 * 用转录指纹判断这份断点是否已经覆盖当前对话。
 *
 * @param {string} text 整理后的转录
 * @returns {string} sha256
 */
function hashTranscript(text) {
  return createHash('sha256').update(text).digest('hex')
}

function parseJsonObject(raw) {
  const stripped = String(raw || '').replace(FENCE_PATTERN, '$1').trim()
  let data
  try {
    data = JSON.parse(stripped)
  } catch {
    throw new SessionRecordError(FAIL_BAD_MODEL)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SessionRecordError(FAIL_BAD_MODEL)
  }
  return data
}

function fieldText(value) {
  const cleaned = redactSecrets(typeof value === 'string' ? value.trim() : '')
  return cleaned || EMPTY_FIELD
}

module.exports = {
  CHECK_UNCONFIGURED,
  BREAKPOINT_SYSTEM,
  buildBreakpointPrompt,
  parseBreakpointReply,
  renderBreakpoint,
  replaceCheckSection,
  hashTranscript,
}

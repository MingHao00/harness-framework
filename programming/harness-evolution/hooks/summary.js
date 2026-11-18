'use strict'

const path = require('path')
const { redactSecrets } = require('./redact')
const { SessionRecordError } = require('./errors')
const {
  EMPTY_FIELD,
  DECISION_FILE_PATTERN,
  FENCE_PATTERN,
  INDEX_SUMMARY_MAX_CHARS,
  FAIL_BAD_MODEL,
  SESSION_MARKER_PATTERN,
  SENTENCE_SPLIT_PATTERN,
} = require('./constants')

/**
 * 把模型输出收成固定字段。
 *
 * @param {string} raw 模型返回的 JSON 文本
 * @returns {object} 规范化后的摘要
 * @throws {SessionRecordError} JSON 无法解析或 hasWork 不是布尔值
 */
function parseModelSummary(raw) {
  const data = parseJsonObject(raw)
  const decisions = normalizeDecisions(data.decisions)
  return {
    hasWork: data.hasWork,
    did: asText(data.did),
    paths: normalizePaths(data.paths),
    unfinished: asText(data.unfinished),
    hasDecision: data.hasDecision === true && decisions.length > 0,
    failed: asText(data.failed),
    next: asText(data.next),
    commands: asText(data.commands),
    decisions,
    supersedes: decisionFileName(data.supersedes),
  }
}

/**
 * 落盘前再脱敏一次，并去掉可能伪造的幂等标记。
 *
 * @param {object} summary parseModelSummary 的结果
 * @returns {object} 可写入仓库的摘要
 */
function redactSummary(summary) {
  return {
    ...summary,
    did: cleanField(summary.did),
    unfinished: cleanField(summary.unfinished),
    failed: cleanField(summary.failed),
    next: cleanField(summary.next),
    commands: cleanField(summary.commands),
    paths: summary.paths.map((item) => cleanField(item)),
    decisions: summary.decisions.map((item) => ({
      chose: cleanField(item.chose),
      rejected: cleanField(item.rejected),
      why: cleanField(item.why),
      reopenWhen: cleanField(item.reopenWhen),
    })),
  }
}

/**
 * 索引用的一句话，不收录正文。
 *
 * @param {string} text 摘要或「定了什么」
 * @returns {string} 截断后的一句
 */
function toIndexSentence(text) {
  const flat = asText(text)
  if (!flat) return EMPTY_FIELD
  const sentence = flat.split(SENTENCE_SPLIT_PATTERN)[0] || flat
  if (sentence.length <= INDEX_SUMMARY_MAX_CHARS) return sentence
  return sentence.slice(0, INDEX_SUMMARY_MAX_CHARS)
}

function parseJsonObject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SessionRecordError(FAIL_BAD_MODEL)
  }
  const fenced = raw.trim().match(FENCE_PATTERN)
  const body = fenced ? fenced[1] : raw.trim()
  const data = parseObject(body)
  if (typeof data.hasWork !== 'boolean') throw new SessionRecordError(FAIL_BAD_MODEL)
  return data
}

function parseObject(body) {
  try {
    const data = JSON.parse(body)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SessionRecordError(FAIL_BAD_MODEL)
    }
    return data
  } catch (error) {
    if (error instanceof SessionRecordError) throw error
    throw new SessionRecordError(FAIL_BAD_MODEL)
  }
}

function asText(value) {
  if (typeof value !== 'string') return ''
  // 全局正则会记住 lastIndex，不复位时下一次替换会漏掉标记。
  SESSION_MARKER_PATTERN.lastIndex = 0
  return value.replace(SESSION_MARKER_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function cleanField(value) {
  return asText(redactSecrets(value))
}

function normalizePaths(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

function normalizeDecisions(value) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeDecision).filter(isMeaningfulDecision)
}

function normalizeDecision(item) {
  const source = item && typeof item === 'object' ? item : {}
  return {
    chose: asText(source.chose),
    rejected: asText(source.rejected),
    why: asText(source.why),
    reopenWhen: asText(source.reopenWhen),
  }
}

function isMeaningfulDecision(item) {
  return [item.chose, item.rejected, item.why, item.reopenWhen]
    .some((field) => field && field !== EMPTY_FIELD)
}

function decisionFileName(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const base = path.win32.basename(value.trim().replace(/\\/g, '/'))
  const portable = path.posix.basename(base)
  if (!DECISION_FILE_PATTERN.test(portable)) return ''
  return portable
}

module.exports = { parseModelSummary, redactSummary, toIndexSentence }

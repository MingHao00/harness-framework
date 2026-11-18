'use strict'

const { redactSecrets } = require('./redact')
const { SessionRecordError } = require('./errors')
const { FENCE_PATTERN, FAIL_BAD_MODEL } = require('./constants')

const DRAFT_STATUS = 'draft'
const PENDING_STATUS = 'pending'
const ITEM_FIELDS = ['file', 'category', 'what', 'change', 'check']
const ALLOWED_CATEGORIES = new Set([
  'user_corrections',
  'repeated_artifact_errors',
  'default_approaches',
  'framework_pitfalls',
  'framework_scaffolds',
])
const DRAFT_NOTICE = '有一份待确认的自进化草稿'
const PATH_NOTICE = '有一份待确认的自进化抽取'
const DRAFT_NEXT = '读取 continuous-learning 技能，把草稿逐条给用户看，用户同意前不要写入。'
const PATH_NEXT = '读取 continuous-learning 技能，按转录起草，用户同意前不要写入。'

/**
 * 收成可展示的草稿。来源固定为这次转录，不合格的条目丢掉。
 *
 * @param {string} raw 模型返回的 JSON
 * @param {string} source 转录路径
 * @returns {Array<{ file: string, category: string, what: string, change: string, check: string, source: string }>}
 * @throws {SessionRecordError} 返回不是 JSON 对象
 */
function parseDraftItems(raw, source) {
  const data = parsePayload(raw)
  const rows = Array.isArray(data.items) ? data.items : []
  return rows.map((row) => normalizeItem(row, source)).filter(Boolean)
}

/**
 * 模型失败时只留下下一场还能再抽的转录路径。
 *
 * @param {{ transcriptPath: string, messageCount: number, learnedSkillsPath: string }} fields
 * @returns {object} pending.json 正文
 */
function pendingPayload(fields) {
  return {
    transcriptPath: fields.transcriptPath,
    messageCount: fields.messageCount,
    learnedSkillsPath: fields.learnedSkillsPath,
    status: PENDING_STATUS,
  }
}

/**
 * @param {{ transcriptPath: string, messageCount: number, learnedSkillsPath: string }} fields
 * @param {object[]} items 已通过校验的草稿
 * @returns {object} 带 items 的 pending.json 正文
 */
function draftPayload(fields, items) {
  return { ...pendingPayload(fields), status: DRAFT_STATUS, items }
}

/**
 * 有条目就逐条给人看。只有转录路径时，下一场再抽。
 *
 * @param {string | null} raw pending.json 原文
 * @returns {{ found: string, next: string }} 两句提示
 */
function pendingNotice(raw) {
  const data = readNotice(raw)
  const items = data && Array.isArray(data.items) ? data.items : []
  if (data && data.status === DRAFT_STATUS && items.length > 0) {
    return { found: DRAFT_NOTICE, next: DRAFT_NEXT }
  }
  return { found: PATH_NOTICE, next: PATH_NEXT }
}

function parsePayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new SessionRecordError(FAIL_BAD_MODEL)
  const fenced = raw.trim().match(FENCE_PATTERN)
  const body = fenced ? fenced[1] : raw.trim()
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

function normalizeItem(row, source) {
  if (!row || typeof row !== 'object') return null
  const item = {}
  for (const field of ITEM_FIELDS) {
    const text = cleanField(row[field])
    if (!text) return null
    item[field] = text
  }
  if (!ALLOWED_CATEGORIES.has(item.category)) return null
  item.source = source
  return item
}

function cleanField(value) {
  if (typeof value !== 'string') return ''
  return redactSecrets(value).replace(/\s+/g, ' ').trim()
}

function readNotice(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data
  } catch {
    return null
  }
}

module.exports = {
  DRAFT_STATUS,
  PENDING_STATUS,
  parseDraftItems,
  pendingPayload,
  draftPayload,
  pendingNotice,
}

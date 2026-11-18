'use strict'

const {
  CURRENT_HEADING,
  SUPERSEDED_HEADING,
  DECISION_INDEX_TITLE,
  LOG_INDEX_TITLE,
} = require('./constants')

/**
 * 幂等标记。已出现则这次对话不再写。
 *
 * @param {string} shortId 对话短号
 * @returns {string} HTML 注释
 */
function sessionMarker(shortId) {
  return `<!-- session:${shortId} -->`
}

/**
 * @param {string} markdown 当天工作日志
 * @param {string} shortId 对话短号
 * @returns {boolean} 是否已经记过这次对话
 */
function hasSessionMarker(markdown, shortId) {
  return String(markdown || '').includes(sessionMarker(shortId))
}

/**
 * 只在文末追加，不改已有正文。
 *
 * @param {string} existing 已有内容
 * @param {string} addition 新内容
 * @returns {string} 拼接结果
 */
function appendText(existing, addition) {
  if (!existing) return addition
  if (existing.endsWith('\n')) return `${existing}\n${addition}`
  return `${existing}\n\n${addition}`
}

/**
 * 把新决策放进「当前」。若替代了旧文件，把旧行移到「已替代」。
 *
 * @param {string} existing 现有索引
 * @param {string} newLine 新的当前行
 * @param {string} supersededFileName 被替代的文件名；没有则空
 * @returns {string} 重排后的索引
 */
function updateDecisionIndex(existing, newLine, supersededFileName) {
  const sections = parseDecisionIndex(existing)
  moveSuperseded(sections, supersededFileName)
  if (!sections.current.includes(newLine)) sections.current.push(newLine)
  return renderDecisionIndex(sections)
}

/**
 * @param {string} text 决策索引全文
 * @returns {string[]} 「当前」段的列表行
 */
function readCurrentLines(text) {
  return parseDecisionIndex(text).current
}

/**
 * @param {string} text 工作日志索引
 * @param {string} shortId 对话短号
 * @returns {boolean} 这一行是否已经在
 */
function logIndexHasShortId(text, shortId) {
  return shortIdAtLineStart(shortId, 'm').test(String(text || ''))
}

/**
 * 同一短号已经在「当前」或「已替代」时，不能再追加一行。
 *
 * @param {string} text 决策索引全文
 * @param {string} shortId 对话短号
 * @returns {boolean} 是否已经有这个短号
 */
function decisionIndexHasShortId(text, shortId) {
  const pattern = shortIdAtLineStart(shortId)
  const sections = parseDecisionIndex(text)
  const lines = sections.current.concat(sections.superseded)
  return lines.some((line) => pattern.test(line))
}

/**
 * 索引不分段，只追加一行。
 *
 * @param {string} existing 现有索引
 * @param {string} line 新行，不含换行
 * @returns {string} 追加后的全文
 */
function appendLogIndex(existing, line) {
  const body = String(existing || '')
  if (!body.trim()) return `${LOG_INDEX_TITLE}\n\n${line}\n`
  const base = body.endsWith('\n') ? body : `${body}\n`
  return `${base}${line}\n`
}

function parseDecisionIndex(text) {
  const current = []
  const superseded = []
  let section = ''
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === CURRENT_HEADING) {
      section = 'current'
      continue
    }
    if (trimmed === SUPERSEDED_HEADING) {
      section = 'superseded'
      continue
    }
    if (!trimmed.startsWith('- ')) continue
    if (section === 'current') current.push(trimmed)
    if (section === 'superseded') superseded.push(trimmed)
  }
  return { current, superseded }
}

function moveSuperseded(sections, fileName) {
  if (!fileName) return
  const staying = []
  for (const line of sections.current) {
    if (lineMentionsFile(line, fileName)) sections.superseded.push(line)
    else staying.push(line)
  }
  sections.current = staying
}

/**
 * @param {string} line 索引行
 * @param {string} fileName 决策文件名
 * @returns {boolean} 这一行是否指向该文件
 */
function lineMentionsFile(line, fileName) {
  return line.split(/\s+/).includes(fileName)
}

function renderDecisionIndex(sections) {
  const parts = [DECISION_INDEX_TITLE, '', CURRENT_HEADING, '']
  if (sections.current.length) parts.push(sections.current.join('\n'), '')
  parts.push(SUPERSEDED_HEADING, '')
  if (sections.superseded.length) parts.push(sections.superseded.join('\n'), '')
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function shortIdAtLineStart(shortId, flags) {
  const source = `^- \\d{4}-\\d{2}-\\d{2} ${escapeRegExp(shortId)}(?:\\s|$)`
  if (!flags) return new RegExp(source)
  return new RegExp(source, flags)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  sessionMarker,
  hasSessionMarker,
  appendText,
  updateDecisionIndex,
  readCurrentLines,
  logIndexHasShortId,
  decisionIndexHasShortId,
  lineMentionsFile,
  appendLogIndex,
}

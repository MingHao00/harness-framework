'use strict'

const { EMPTY_FIELD, DISPLAY_INDEX_OFFSET } = require('./constants')

/**
 * 一次对话的工作日志小节。时间只写在标题里。
 *
 * @param {object} fields 栏目文本
 * @returns {string} 以换行结尾的 Markdown
 */
function formatWorkSection(fields) {
  const lines = [
    `## ${fields.shortId} ${fields.minute}`,
    '',
    `<!-- session:${fields.shortId} -->`,
    '',
    `- 做了什么：${orEmpty(fields.did)}`,
    `- 改过或读过的路径：${formatPaths(fields.paths)}`,
    `- 还没做完的事：${orEmpty(fields.unfinished)}`,
    `- 有没有决策文件：${fields.decisionPath || EMPTY_FIELD}`,
    `- 试过但行不通的做法及原因：${orEmpty(fields.failed)}`,
    `- 下一步的第一个动作：${orEmpty(fields.next)}`,
  ]
  if (typeof fields.commands === 'string' && fields.commands.trim()) {
    lines.push(`- 命令和结果：${fields.commands.trim()}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * 一次对话的决策文件。只有旧文件确实存在时才写替代行。
 *
 * @param {object} fields 决策栏目
 * @returns {string} 以换行结尾的 Markdown
 */
function formatDecisionDocument(fields) {
  const lines = [
    `# ${fields.date}-${fields.shortId}`,
    '',
    `- 时间：${fields.minute}`,
    `- 对话短号：${fields.shortId}`,
  ]
  if (fields.supersedes) lines.push(`- 替代：${fields.supersedes}`)
  fields.decisions.forEach((item, index) => {
    lines.push('', `## ${index + DISPLAY_INDEX_OFFSET}`, '', ...decisionLines(item))
  })
  return `${lines.join('\n')}\n`
}

/**
 * 一次失败一条记录。不含密钥。
 *
 * @param {object} fields 时间、短号、原因
 * @returns {string} 以换行结尾的 Markdown
 */
function formatErrorDocument(fields) {
  return [
    '# 会话记录失败',
    '',
    `- 时间：${fields.minute}`,
    `- 对话短号：${fields.shortId}`,
    `- 失败原因：${orEmpty(fields.reason)}`,
    '',
  ].join('\n')
}

/**
 * 工作日志索引的一行。
 *
 * @param {{ date: string, shortId: string, sentence: string }} fields
 * @returns {string} 不含换行的列表项
 */
function formatLogIndexLine(fields) {
  return `- ${fields.date} ${fields.shortId} ${fields.sentence}`
}

/**
 * 决策索引的一行。文件名单独成词，方便以后移动。
 *
 * @param {{ date: string, shortId: string, sentence: string, fileName: string }} fields
 * @returns {string} 不含换行的列表项
 */
function formatDecisionIndexLine(fields) {
  return `- ${fields.date} ${fields.shortId} ${fields.sentence} ${fields.fileName}`
}

/**
 * 新建当天工作日志时的标题。已有文件不调用它，避免改掉旧内容。
 *
 * @param {string} date 北京时间日历日
 * @param {string} section 第一小节
 * @returns {string} 完整文件
 */
function createWorkLog(date, section) {
  return `# ${date} 工作日志\n\n${section}`
}

function orEmpty(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || EMPTY_FIELD
}

function formatPaths(paths) {
  if (!paths || !paths.length) return EMPTY_FIELD
  return paths.map((item) => `\`${item}\``).join('、')
}

function decisionLines(item) {
  return [
    `- 定了什么：${orEmpty(item.chose)}`,
    `- 否掉了什么：${orEmpty(item.rejected)}`,
    `- 为什么：${orEmpty(item.why)}`,
    `- 什么新需求出现时应该重开：${orEmpty(item.reopenWhen)}`,
  ]
}

module.exports = {
  formatWorkSection,
  formatDecisionDocument,
  formatErrorDocument,
  formatLogIndexLine,
  formatDecisionIndexLine,
  createWorkLog,
}

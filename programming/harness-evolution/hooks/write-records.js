'use strict'

const fs = require('fs/promises')
const path = require('path')
const {
  LOG_DIR_NAME,
  DECISION_DIR_NAME,
  ERROR_DIR_NAME,
  INDEX_FILE_NAME,
} = require('./constants')
const {
  hasSessionMarker,
  appendText,
  updateDecisionIndex,
  readCurrentLines,
  logIndexHasShortId,
  decisionIndexHasShortId,
  lineMentionsFile,
  appendLogIndex,
} = require('./index-text')
const {
  formatWorkSection,
  formatDecisionDocument,
  formatErrorDocument,
  formatLogIndexLine,
  formatDecisionIndexLine,
  createWorkLog,
} = require('./format-record')
const { toIndexSentence } = require('./summary')
const { replaceFile, withFileLock } = require('./atomic-file')

/**
 * 同一天同一短号已经写过，就不再调用模型。
 *
 * @param {string} repoRoot 仓库根
 * @param {string} date 北京时间日历日
 * @param {string} shortId 对话短号
 * @param {(filePath: string, encoding: string) => Promise<string>} [readFile]
 *   测试注入的读取；不传则读磁盘
 * @returns {Promise<boolean>} 是否已有这次对话
 * @throws {Error} 工作日志存在但读失败
 */
async function sessionAlreadyRecorded(repoRoot, date, shortId, readFile) {
  const existing = await readIfExists(logFile(repoRoot, date), readFile)
  return hasSessionMarker(existing, shortId)
}

/**
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 「当前」段的行；文件不存在则为空
 */
async function readCurrentDecisionLines(repoRoot) {
  const text = await readIfExists(decisionIndexPath(repoRoot))
  return readCurrentLines(text)
}

/**
 * 先写决策，最后才写带幂等标记的工作日志，中途失败还能重跑补完。
 *
 * @param {string} repoRoot 仓库根
 * @param {object} fields 摘要和北京时间
 * @returns {Promise<string>} 决策相对路径；没有决策则为空
 */
async function persistRecords(repoRoot, fields) {
  const decisionPath = await persistDecision(repoRoot, fields)
  await persistLogIndex(repoRoot, fields)
  await persistWorkLog(repoRoot, { ...fields, decisionPath })
  return decisionPath
}

/**
 * 失败记录按日期和短号留下。已有内容只追加，不删除。
 *
 * @param {string} repoRoot 仓库根
 * @param {object} fields 时间、短号、原因
 * @returns {Promise<void>}
 */
async function writeErrorReport(repoRoot, fields) {
  const filePath = errorFile(repoRoot, fields.date, fields.shortId)
  await withFileLock(filePath, () => appendError(filePath, fields))
}

async function persistDecision(repoRoot, fields) {
  if (!fields.hasDecision) return ''
  const fileName = `${fields.date}-${fields.shortId}.md`
  const indexPath = decisionIndexPath(repoRoot)
  await withFileLock(indexPath, () => writeDecisionLocked(repoRoot, fields, fileName))
  return `${DECISION_DIR_NAME}/${fileName}`
}

async function writeDecisionLocked(repoRoot, fields, fileName) {
  const indexPath = decisionIndexPath(repoRoot)
  const existing = await readIfExists(indexPath)
  const superseded = await supersedeFromIndex(repoRoot, existing, fields.supersedes)
  await writeDecisionBody(repoRoot, fields, superseded)
  // 短号已在索引里时，摘要换一句也不能再追加，否则中断重跑会重复。
  if (decisionIndexHasShortId(existing, fields.shortId)) return
  const line = formatDecisionIndexLine({
    date: fields.date,
    shortId: fields.shortId,
    sentence: toIndexSentence(fields.decisions[0].chose),
    fileName,
  })
  await replaceFile(indexPath, updateDecisionIndex(existing, line, superseded))
}

async function supersedeFromIndex(repoRoot, indexText, fileName) {
  if (!fileName) return ''
  // 不在「当前」，或文件已经不在，就不是这次要替代的决策。
  const current = readCurrentLines(indexText)
  if (!current.some((line) => lineMentionsFile(line, fileName))) return ''
  try {
    await fs.access(path.join(repoRoot, DECISION_DIR_NAME, fileName))
    return fileName
  } catch {
    return ''
  }
}

async function writeDecisionBody(repoRoot, fields, superseded) {
  const filePath = decisionFile(repoRoot, fields.date, fields.shortId)
  await withFileLock(filePath, () => writeBodyIfEmpty(filePath, fields, superseded))
}

async function writeBodyIfEmpty(filePath, fields, superseded) {
  const existing = await readIfExists(filePath)
  // 重跑不能把已经写好的正文换成空文件或另一句摘要。
  if (existing.trim()) return
  const body = formatDecisionDocument({ ...fields, supersedes: superseded })
  await replaceFile(filePath, body)
}

async function persistLogIndex(repoRoot, fields) {
  const indexPath = logIndexPath(repoRoot)
  await withFileLock(indexPath, () => appendLogLine(indexPath, fields))
}

async function appendLogLine(indexPath, fields) {
  const existing = await readIfExists(indexPath)
  if (logIndexHasShortId(existing, fields.shortId)) return
  const line = formatLogIndexLine({
    date: fields.date,
    shortId: fields.shortId,
    sentence: toIndexSentence(fields.did),
  })
  await replaceFile(indexPath, appendLogIndex(existing, line))
}

async function persistWorkLog(repoRoot, fields) {
  const filePath = logFile(repoRoot, fields.date)
  await withFileLock(filePath, () => appendWorkSection(filePath, fields))
}

async function appendWorkSection(filePath, fields) {
  const existing = await readIfExists(filePath)
  if (hasSessionMarker(existing, fields.shortId)) return
  const section = formatWorkSection(fields)
  const next = existing ? appendText(existing, section) : createWorkLog(fields.date, section)
  await replaceFile(filePath, next)
}

async function appendError(filePath, fields) {
  const existing = await readIfExists(filePath)
  const next = existing
    ? appendText(existing, formatErrorDocument(fields))
    : formatErrorDocument(fields)
  await replaceFile(filePath, next)
}

function logFile(repoRoot, date) {
  return path.join(repoRoot, LOG_DIR_NAME, `${date}.md`)
}

function decisionFile(repoRoot, date, shortId) {
  return path.join(repoRoot, DECISION_DIR_NAME, `${date}-${shortId}.md`)
}

function decisionIndexPath(repoRoot) {
  return path.join(repoRoot, DECISION_DIR_NAME, INDEX_FILE_NAME)
}

function logIndexPath(repoRoot) {
  return path.join(repoRoot, LOG_DIR_NAME, INDEX_FILE_NAME)
}

function errorFile(repoRoot, date, shortId) {
  return path.join(repoRoot, LOG_DIR_NAME, ERROR_DIR_NAME, `${date}-${shortId}.md`)
}

async function readIfExists(filePath, readFile) {
  try {
    const read = typeof readFile === 'function' ? readFile : fs.readFile
    return await read(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

module.exports = {
  sessionAlreadyRecorded,
  readCurrentDecisionLines,
  persistRecords,
  writeErrorReport,
}

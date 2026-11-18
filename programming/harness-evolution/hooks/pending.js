'use strict'

const fs = require('fs/promises')
const path = require('path')
const { replaceFile } = require('./atomic-file')
const { PENDING_DIR_NAME, PENDING_FILE_NAME } = require('./constants')

/**
 * 记下这一轮的转录路径。同一对话后来的轮次覆盖这一笔，不调用模型。
 *
 * @param {string} repoRoot 仓库根
 * @param {string} sessionId 对话 id
 * @param {string} transcriptPath 转录文件
 * @returns {Promise<void>}
 */
async function upsertPending(repoRoot, sessionId, transcriptPath) {
  const filePath = pendingPath(repoRoot)
  const data = await readPending(filePath)
  data.sessions[sessionId] = {
    transcriptPath,
    updatedAt: new Date().toISOString(),
  }
  await replaceFile(filePath, serializePending(data))
}

/**
 * 已经写完或确定失败的对话不再留在待处理里。
 *
 * @param {string} repoRoot 仓库根
 * @param {string} sessionId 对话 id
 * @returns {Promise<void>}
 */
async function removePending(repoRoot, sessionId) {
  const filePath = pendingPath(repoRoot)
  const data = await readPending(filePath)
  if (!data.sessions[sessionId]) return
  delete data.sessions[sessionId]
  await replaceFile(filePath, serializePending(data))
}

/**
 * @param {string} repoRoot 仓库根
 * @returns {Promise<Array<{ sessionId: string, transcriptPath: string }>>}
 */
async function listPending(repoRoot) {
  const data = await readPending(pendingPath(repoRoot))
  return Object.entries(data.sessions)
    .filter((entry) => entry[1] && typeof entry[1].transcriptPath === 'string')
    .map(([sessionId, value]) => ({
      sessionId,
      transcriptPath: value.transcriptPath,
    }))
}

function pendingPath(repoRoot) {
  return path.join(repoRoot, PENDING_DIR_NAME, PENDING_FILE_NAME)
}

async function readPending(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (parsed && parsed.sessions && typeof parsed.sessions === 'object') return parsed
  } catch {
    // 还没有待处理，或文件损坏。从空表开始，避免挡住下一次写入。
  }
  return { sessions: {} }
}

function serializePending(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}

module.exports = { upsertPending, removePending, listPending, pendingPath }

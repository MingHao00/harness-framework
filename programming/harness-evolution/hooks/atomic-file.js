'use strict'

const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const TEMP_PREFIX = '.session-record-'
const TEMP_SUFFIX = '.tmp'
const BACKUP_SUFFIX = '.bak'
const RANDOM_BYTES = 8
const BACKUP_LEFT_TEXT = '旧内容留在'
const RENAME_CONFLICT_CODES = new Set(['EPERM', 'EEXIST'])

const chains = new Map()

/**
 * 同一路径在进程内串行读写改，避免两次追加互相盖掉。
 *
 * @param {string} filePath 目标文件
 * @param {() => Promise<void>} task 临界区
 * @returns {Promise<void>}
 * @throws {Error} task 抛出的错误
 */
function withFileLock(filePath, task) {
  const key = path.resolve(filePath)
  const previous = chains.get(key) || Promise.resolve()
  // 上一次失败也要放行，否则这条路径会被一个错误永久卡住。
  const run = previous.then(task, task)
  const settled = run.then(release, release)
  chains.set(key, settled)
  return run

  function release() {
    if (chains.get(key) === settled) chains.delete(key)
  }
}

/**
 * 先写同目录临时文件再改名。失败时保留目标上已有的内容。
 *
 * @param {string} filePath 目标路径
 * @param {string} contents 完整新内容
 * @param {(from: string, to: string) => Promise<void>} [renameFile]
 *   默认 fs.rename。测试可换成会失败的实现。
 * @returns {Promise<void>}
 * @throws {Error} 替换没完成时抛出。旧文件移不回去时，信息里有备份路径。
 */
async function replaceFile(filePath, contents, renameFile = fs.rename) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = siblingPath(filePath, TEMP_SUFFIX)
  await fs.writeFile(tempPath, contents, 'utf8')
  try {
    await renameFile(tempPath, filePath)
  } catch (error) {
    await recoverReplace(filePath, tempPath, error, renameFile)
  }
}

async function recoverReplace(filePath, tempPath, error, renameFile) {
  if (!isRenameConflict(error)) {
    await removeQuiet(tempPath)
    throw error
  }
  // Windows 上 rename 覆盖已有文件可能失败，不能改用会先把目标截空的写入。
  await replaceByBackup(filePath, tempPath, renameFile)
}

async function replaceByBackup(filePath, tempPath, renameFile) {
  const backupPath = siblingPath(filePath, BACKUP_SUFFIX)
  try {
    await renameFile(filePath, backupPath)
  } catch (error) {
    await removeQuiet(tempPath)
    throw error
  }
  try {
    await renameFile(tempPath, filePath)
  } catch (error) {
    await failInstall(backupPath, filePath, tempPath, error, renameFile)
  }
  await removeQuiet(backupPath)
}

async function failInstall(backupPath, filePath, tempPath, error, renameFile) {
  try {
    await renameFile(backupPath, filePath)
  } catch (restoreError) {
    await removeQuiet(tempPath)
    // 备份是旧内容的唯一副本，移不回原路径就不能删。
    throw backupLeftError(error, backupPath, restoreError)
  }
  await removeQuiet(tempPath)
  // 覆盖没有完成，调用方不能把旧文件当成已经换成新内容。
  throw error
}

function backupLeftError(error, backupPath, restoreError) {
  const wrapped = new Error(`${error.message}; ${BACKUP_LEFT_TEXT} ${backupPath}`)
  wrapped.code = error.code
  wrapped.backupPath = backupPath
  wrapped.cause = restoreError
  return wrapped
}

function isRenameConflict(error) {
  return Boolean(error && RENAME_CONFLICT_CODES.has(error.code))
}

function siblingPath(filePath, suffix) {
  const token = crypto.randomBytes(RANDOM_BYTES).toString('hex')
  const name = `${TEMP_PREFIX}${process.pid}-${Date.now()}-${token}${suffix}`
  return path.join(path.dirname(filePath), name)
}

function removeQuiet(filePath) {
  return fs.unlink(filePath).catch(() => {
    // 清理失败不能盖掉已经替换好的目标。
  })
}

module.exports = { withFileLock, replaceFile }

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { replaceFile } = require('./atomic-file')

const READ_ONLY_MODE = 0o444
const FILE_NAME = 'day.md'
const OLD_CONTENT = 'old-content-kept'
const NEW_CONTENT = 'new-content-kept'
const RENAME_FAILED = 'rename failed'
const REPLACE_SHOULD_FAIL = '替换应当失败'
const CONFLICT_CODE = 'EPERM'
const INSTALL_CODE = 'EIO'
const FIRST_TARGET_RENAME = 1
// 第一次是直接覆盖，第二次是挪走原文件后再安装；第三次才把备份移回去。
const FAILED_TARGET_RENAMES = 2

test('replaces an existing file without leaving a temp', async () => {
  await withDir(async (dir) => {
    const target = path.join(dir, FILE_NAME)
    await fs.writeFile(target, OLD_CONTENT, 'utf8')
    await replaceFile(target, NEW_CONTENT)
    assert.equal(await fs.readFile(target, 'utf8'), NEW_CONTENT)
    assert.deepEqual(await fs.readdir(dir), [FILE_NAME])
  })
})

test('replaces a file when rename will not overwrite it', async () => {
  await withDir(async (dir) => {
    const target = path.join(dir, FILE_NAME)
    await fs.writeFile(target, OLD_CONTENT, 'utf8')
    await fs.chmod(target, READ_ONLY_MODE)
    await replaceFile(target, NEW_CONTENT)
    assert.equal(await fs.readFile(target, 'utf8'), NEW_CONTENT)
    assert.deepEqual(await fs.readdir(dir), [FILE_NAME])
  })
})

test('puts the old file back when the second rename fails', async () => {
  await withDir(async (dir) => {
    const target = path.join(dir, FILE_NAME)
    await fs.writeFile(target, OLD_CONTENT, 'utf8')
    const rename = failTargetRenames(target, FAILED_TARGET_RENAMES)
    const error = await rejectedReplace(target, rename)
    assert.equal(error.code, INSTALL_CODE)
    assert.equal(error.backupPath, undefined)
    assert.equal(await fs.readFile(target, 'utf8'), OLD_CONTENT)
    assert.deepEqual(await fs.readdir(dir), [FILE_NAME])
  })
})

test('keeps the backup when it cannot move back', async () => {
  await withDir(async (dir) => {
    const target = path.join(dir, FILE_NAME)
    await fs.writeFile(target, OLD_CONTENT, 'utf8')
    const error = await rejectedReplace(target, blockRenameOnto(target))
    assert.equal(error.message.includes(error.backupPath), true)
    assert.equal(await fs.readFile(error.backupPath, 'utf8'), OLD_CONTENT)
    await assert.rejects(fs.access(target))
  })
})

function failTargetRenames(target, times) {
  let seen = 0
  return async (from, to) => {
    if (to !== target) return fs.rename(from, to)
    seen += 1
    if (seen > times) return fs.rename(from, to)
    const error = new Error(RENAME_FAILED)
    error.code = seen === FIRST_TARGET_RENAME ? CONFLICT_CODE : INSTALL_CODE
    throw error
  }
}

function blockRenameOnto(target) {
  return async (from, to) => {
    if (to !== target) return fs.rename(from, to)
    const error = new Error(RENAME_FAILED)
    error.code = CONFLICT_CODE
    throw error
  }
}

async function rejectedReplace(target, rename) {
  try {
    await replaceFile(target, NEW_CONTENT, rename)
  } catch (error) {
    return error
  }
  throw new Error(REPLACE_SHOULD_FAIL)
}

async function withDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-record-'))
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

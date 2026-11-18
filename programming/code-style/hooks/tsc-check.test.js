'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')
const { typecheckMessage, findTsconfigDir } = require('./tsc-check')

const SCRIPT = path.join(__dirname, 'tsc-check.js')
const LINE_LIMIT = 10
const EXTRA_LINE = 11

test('findTsconfigDir returns the nearest project and stops at the drive root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tsc-dir-'))
  try {
    const project = path.join(root, 'app')
    const filePath = path.join(project, 'src', 'main.ts')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(path.join(project, 'tsconfig.json'), '{}\n', 'utf8')
    await fs.writeFile(filePath, 'export {}\n', 'utf8')
    assert.equal(findTsconfigDir(filePath), project)
    const driveFile = path.join(path.parse(filePath).root, 'file.ts')
    assert.equal(findTsconfigDir(driveFile), '')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('typecheck output keeps related lines up to the limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tsc-msg-'))
  try {
    const project = path.join(root, 'app')
    const filePath = path.join(project, 'src', 'main.ts')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(path.join(project, 'tsconfig.json'), '{}\n', 'utf8')
    await fs.writeFile(filePath, 'export {}\n', 'utf8')
    const limited = typecheckMessage(filePath, () => ({
      stdout: numberedErrors(filePath, EXTRA_LINE),
      stderr: '',
    }))
    assert.equal(limited.split('\n').length, LINE_LIMIT)
    assert.equal(limited.includes('(11,1)'), false)
    const base = path.basename(filePath)
    const mixed = typecheckMessage(filePath, () => ({
      stdout: 'other.ts(1,1): error',
      stderr: `${base}(3,1): error TS3`,
    }))
    assert.equal(mixed, `${base}(3,1): error TS3`)
    assert.equal(typecheckMessage('', () => ({})), '')
    assert.equal(typecheckMessage(path.join(project, 'missing.ts'), () => ({})), '')
    const script = path.join(project, 'app.js')
    await fs.writeFile(script, 'const value = 1\n', 'utf8')
    assert.equal(typecheckMessage(script, () => ({})), '')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the hook process returns before typecheck when the file is out of scope', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsc-hook-'))
  try {
    const script = path.join(dir, 'app.js')
    await fs.writeFile(script, 'const value = 1\n', 'utf8')
    const missing = runNode(SCRIPT, {
      input: JSON.stringify({ file_path: path.join(dir, 'missing.ts') }),
    })
    const javascript = runNode(SCRIPT, { input: JSON.stringify({ path: script }) })
    const empty = runNode(SCRIPT, { input: '' })
    for (const result of [missing, javascript, empty]) {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

function numberedErrors(filePath, count) {
  const lines = Array.from(
    { length: count },
    (_, index) => `${filePath}(${index + 1},1): error`,
  )
  return lines.join('\n')
}

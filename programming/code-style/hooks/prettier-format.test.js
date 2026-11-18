'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')
const { formatEditedFile, findProjectRoot, hasPrettier } = require('./prettier-format')

const SCRIPT = path.join(__dirname, 'prettier-format.js')
const CONFIG_NAMES = ['prettier.config.js', '.prettierrc.yaml']

test('project root and prettier config are detected from the file path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prettier-root-'))
  try {
    const project = path.join(root, 'app')
    const filePath = path.join(project, 'src', 'a.js')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'const value = 1\n', 'utf8')
    await fs.writeFile(path.join(project, 'package.json'), '{}\n', 'utf8')
    assert.equal(findProjectRoot(filePath), project)
    assert.equal(hasPrettier(project), false)
    const driveFile = path.join(path.parse(filePath).root, 'file.js')
    assert.equal(findProjectRoot(driveFile), '')
    for (const name of CONFIG_NAMES) {
      const dir = path.join(root, name)
      await fs.mkdir(dir)
      await fs.writeFile(path.join(dir, 'package.json'), '{}\n', 'utf8')
      await fs.writeFile(path.join(dir, name), '{}\n', 'utf8')
      assert.equal(hasPrettier(dir), true, name)
    }
    await fs.writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({ prettier: { semi: false } }),
      'utf8',
    )
    assert.equal(hasPrettier(project), true)
    await fs.writeFile(path.join(project, 'package.json'), '{', 'utf8')
    assert.equal(hasPrettier(project), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('format runs only for a configured source file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prettier-run-'))
  const calls = []
  try {
    const project = path.join(root, 'app')
    const filePath = path.join(project, 'src', 'a.js')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'const value=1\n', 'utf8')
    await fs.writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({ prettier: true }),
      'utf8',
    )
    const remember = (projectRoot, target) => {
      calls.push([projectRoot, target])
    }
    assert.equal(formatEditedFile(filePath, remember), true)
    assert.deepEqual(calls, [[project, filePath]])
    const markdown = path.join(project, 'README.md')
    await fs.writeFile(markdown, '# title\n', 'utf8')
    assert.equal(formatEditedFile(markdown, remember), false)
    assert.equal(formatEditedFile(path.join(project, 'missing.js'), remember), false)
    const bare = path.join(root, 'bare')
    const loose = path.join(bare, 'b.js')
    await fs.mkdir(bare)
    await fs.writeFile(loose, 'const value = 1\n', 'utf8')
    await fs.writeFile(path.join(bare, 'package.json'), '{}\n', 'utf8')
    assert.equal(formatEditedFile(loose, remember), false)
    assert.equal(calls.length, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the hook process skips files that are not configured source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prettier-hook-'))
  try {
    const markdown = path.join(dir, 'notes.md')
    await fs.writeFile(markdown, '# title\n', 'utf8')
    const cases = [
      JSON.stringify({ filePath: markdown }),
      JSON.stringify({ file_path: path.join(dir, 'missing.js') }),
      '',
    ]
    for (const input of cases) {
      const result = runNode(SCRIPT, { input })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

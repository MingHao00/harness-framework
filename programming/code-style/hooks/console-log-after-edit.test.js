'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')
const { consoleLogWarning } = require('./console-log-after-edit')

const SCRIPT = path.join(__dirname, 'console-log-after-edit.js')
const EXTRA_LINE = 6

test('consoleLogWarning is empty until a match is present', () => {
  assert.equal(consoleLogWarning('app.js', []), '')
  const warning = consoleLogWarning('app.js', ['1: console.log(1)'])
  assert.match(warning, /console\.log found in app\.js/)
  assert.match(warning, /1: console\.log\(1\)/)
  assert.match(warning, /Remove console\.log before committing/)
})

test('after-edit warns only for source files that contain console.log', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'console-edit-'))
  try {
    const logged = await writeLines(dir, 'app.js', EXTRA_LINE)
    const view = await writeLines(dir, 'view.tsx', 1)
    const note = path.join(dir, 'note.py')
    await fs.writeFile(note, 'console.log(1)\n', 'utf8')
    const warned = hookOutput({ file_path: logged })
    assert.match(warned, /console\.log found/)
    assert.match(warned, /5: console\.log\(5\)/)
    assert.equal(warned.includes('6: console.log(6)'), false)
    assert.match(hookOutput({ file_path: view }), /console\.log found/)
    assert.equal(hookStdout({ file_path: path.join(dir, 'clean.js') }), '')
    await fs.writeFile(path.join(dir, 'clean.js'), 'const value = 1\n', 'utf8')
    assert.equal(hookStdout({ file_path: path.join(dir, 'clean.js') }), '')
    assert.equal(hookStdout({ file_path: note }), '')
    assert.equal(hookStdout({ file_path: path.join(dir, 'missing.js') }), '')
    assert.equal(hookStdout(null), '')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeLines(dir, name, count) {
  const filePath = path.join(dir, name)
  const lines = Array.from({ length: count }, (_, index) => `console.log(${index + 1})`)
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
  return filePath
}

function hookOutput(input) {
  return JSON.parse(hookStdout(input)).additional_context
}

function hookStdout(input) {
  const payload = input === null ? 'not-json' : JSON.stringify(input)
  const result = runNode(SCRIPT, { input: payload })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

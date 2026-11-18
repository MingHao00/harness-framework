'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { runNode } = require('./spawn-hook')

const SCRIPT = path.join(__dirname, 'block-markdown.js')
const ALLOWED_PATHS = [
  'README.md',
  'docs/README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'src/app.js',
  '',
]
const BLOCKED_PATHS = ['notes.md', 'notes.txt', 'NOTES.MD', 'README.txt', 'docs/guide.md']

test('markdown hook allows named docs and blocks other text files', () => {
  for (const filePath of ALLOWED_PATHS) {
    const payload = runHook({ file_path: filePath })
    assert.equal(payload.permission, 'allow', filePath)
    assert.equal(payload.user_message, undefined, filePath)
  }
  for (const filePath of BLOCKED_PATHS) {
    const payload = runHook({ file_path: filePath })
    assert.equal(payload.permission, 'deny', filePath)
    assert.match(payload.user_message, /Blocked new documentation file/)
    assert.match(payload.agent_message, /README\.md/)
  }
})

test('invalid hook input is allowed', () => {
  const result = runNode(SCRIPT, { input: 'not-json' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { permission: 'allow' })
})

function runHook(input) {
  const result = runNode(SCRIPT, { input: JSON.stringify(input) })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

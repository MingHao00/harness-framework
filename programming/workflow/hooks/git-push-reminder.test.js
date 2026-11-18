'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')

const SCRIPT = path.join(__dirname, 'git-push-reminder.js')
const REVIEWED = ['git push', 'git  push origin main', 'echo git push']
const SILENT = ['git status', 'gitpush', 'GIT PUSH', '']

test('git push is allowed and asks for a review', () => {
  for (const command of REVIEWED) {
    const payload = runHook({ command })
    assert.equal(payload.permission, 'allow', command)
    assert.match(payload.user_message, /Review the changes/, command)
    assert.match(payload.agent_message, /Continuing with the push/, command)
  }
})

test('commands that are not git push stay silent', () => {
  for (const command of SILENT) {
    const payload = runHook({ command })
    assert.equal(payload.permission, 'allow', command)
    assert.equal(payload.user_message, undefined, command)
  }
  const nested = runHook({ tool_input: { command: 'git push' } })
  assert.match(nested.user_message, /Review the changes/)
})

test('invalid hook input is allowed without a review', () => {
  const result = runNode(SCRIPT, { input: 'not-json' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { permission: 'allow' })
})

function runHook(input) {
  const result = runNode(SCRIPT, { input: JSON.stringify(input) })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

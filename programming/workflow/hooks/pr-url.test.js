'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')

const SCRIPT = path.join(__dirname, 'pr-url.js')
const PR_URL = 'https://github.com/acme/widgets/pull/15'
const CREATE = 'gh pr create --fill'

test('a created pull request is reported with its review command', () => {
  const cases = [
    { command: CREATE, tool_output: `opened ${PR_URL}\n` },
    { command: CREATE, tool_output: { output: PR_URL } },
    { command: CREATE, output: PR_URL },
    { tool_input: { command: CREATE }, output: PR_URL },
  ]
  for (const input of cases) {
    const payload = runHook(input)
    assert.match(payload.additional_context, new RegExp(PR_URL))
    assert.match(payload.additional_context, /gh pr review 15 --repo acme\/widgets/)
  }
})

test('unrelated commands and missing urls produce no context', () => {
  const cases = [
    { command: 'git status', output: PR_URL },
    { command: CREATE, tool_output: 'created without a url' },
    { command: CREATE, tool_output: { output: 15 } },
    { command: CREATE },
    {},
  ]
  for (const input of cases) {
    const result = runNode(SCRIPT, { input: JSON.stringify(input) })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  }
})

function runHook(input) {
  const result = runNode(SCRIPT, { input: JSON.stringify(input) })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

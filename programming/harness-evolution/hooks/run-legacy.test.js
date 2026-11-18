'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { runNode } = require('./spawn-hook')

const SCRIPT = path.join(__dirname, 'run-legacy.js')
const UNSAFE_ARGS = [[], ['..\\outside.js'], ['../outside.js'], ['nested/script.js']]

test('run-legacy ignores a missing or unsafe script name', () => {
  for (const args of UNSAFE_ARGS) {
    const result = runNode(SCRIPT, { args })
    assert.equal(result.status, 0, args.join(' '))
    assert.equal(result.stdout, '', args.join(' '))
  }
})

test('run-legacy wraps child output and forwards stdin', () => {
  const silent = runNode(SCRIPT, { args: ['time.js'] })
  assert.equal(silent.status, 0, silent.stderr)
  assert.equal(silent.stdout, '')
  const missing = runNode(SCRIPT, { args: ['missing-hook.js'] })
  assert.equal(missing.status, 0, missing.stderr)
  const failure = JSON.parse(missing.stdout)
  assert.match(failure.additional_context, /Cannot find module|Error/)
  const forwarded = runNode(SCRIPT, {
    args: ['block-markdown.js'],
    input: JSON.stringify({ file_path: 'README.md' }),
  })
  assert.equal(forwarded.status, 0, forwarded.stderr)
  const payload = JSON.parse(forwarded.stdout)
  assert.match(payload.additional_context, /"permission":"allow"/)
})

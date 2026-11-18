'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode } = require('./spawn-hook')

const SCRIPT = path.join(__dirname, 'suggest-compact.js')
const REACHED = 'tool calls reached'
const CHECKPOINT = 'good checkpoint'

test('suggestions follow the threshold and later intervals', async () => {
  const session = uniqueSession('count')
  const counter = counterPath(session)
  try {
    const first = runCompact(session, 2)
    assert.equal(first.stderr.includes(REACHED), false)
    assert.equal(await fs.readFile(counter, 'utf8'), '1')
    const second = runCompact(session, 2)
    assert.match(second.stderr, new RegExp(`2 ${REACHED}`))
    await fs.writeFile(counter, '49', 'utf8')
    const reached = runCompact(session, 50)
    assert.match(reached.stderr, new RegExp(`50 ${REACHED}`))
    assert.equal(reached.stderr.includes(CHECKPOINT), false)
    await fs.writeFile(counter, '74', 'utf8')
    const later = runCompact(session, 50)
    assert.match(later.stderr, /75 tool calls - good checkpoint/)
    assert.equal(later.stderr.includes(REACHED), false)
  } finally {
    await fs.rm(counter, { force: true })
  }
})

test('blank or unreadable counts do not crash the suggestion', async () => {
  const blank = uniqueSession('blank')
  const blankPath = counterPath(blank)
  const broken = uniqueSession('broken')
  const brokenPath = counterPath(broken)
  const blocked = uniqueSession('blocked')
  const blockedPath = counterPath(blocked)
  try {
    await fs.writeFile(blankPath, '', 'utf8')
    const empty = runCompact(blank, 1)
    assert.match(empty.stderr, new RegExp(`1 ${REACHED}`))
    await fs.writeFile(brokenPath, 'nope', 'utf8')
    const invalid = runCompact(broken, 50)
    assert.equal(invalid.status, 0, invalid.stderr)
    assert.equal(invalid.stderr.includes(REACHED), false)
    assert.equal(await fs.readFile(brokenPath, 'utf8'), '1')
    await fs.mkdir(blockedPath)
    const failed = runCompact(blocked, 1)
    assert.equal(failed.status, 0)
    assert.match(failed.stderr, /\[StrategicCompact\] Error:/)
  } finally {
    await fs.rm(blankPath, { force: true })
    await fs.rm(brokenPath, { force: true })
    await fs.rm(blockedPath, { recursive: true, force: true })
  }
})

function runCompact(session, threshold) {
  const result = runNode(SCRIPT, {
    env: {
      ...process.env,
      CLAUDE_SESSION_ID: session,
      COMPACT_THRESHOLD: String(threshold),
    },
  })
  assert.equal(result.status, 0, result.stderr)
  return result
}

function counterPath(session) {
  return path.join(os.tmpdir(), `claude-tool-count-${session}`)
}

function uniqueSession(label) {
  return `coverage-${label}-${process.pid}-${Math.random().toString(16).slice(2)}`
}

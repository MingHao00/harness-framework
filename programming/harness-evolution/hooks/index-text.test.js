'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  updateDecisionIndex,
  appendLogIndex,
  logIndexHasShortId,
  decisionIndexHasShortId,
} = require('./index-text')
const { CURRENT_HEADING, SUPERSEDED_HEADING } = require('./constants')

const OLD_LINE = '- 2026-10-01 bbbbbbbb 用本地模型 2026-10-01-bbbbbbbb.md'
const KEEP_LINE = '- 2026-10-02 cccccccc 另一条保持 2026-10-02-cccccccc.md'
const NEW_LINE = '- 2026-10-18 a1b2c3d4 改用远端嵌入 2026-10-18-a1b2c3d4.md'
const OLD_FILE = '2026-10-01-bbbbbbbb.md'

test('moves a current decision line into the superseded section', () => {
  const existing = [
    '# 决策索引',
    '',
    CURRENT_HEADING,
    '',
    OLD_LINE,
    KEEP_LINE,
    '',
    SUPERSEDED_HEADING,
    '',
  ].join('\n')
  const next = updateDecisionIndex(existing, NEW_LINE, OLD_FILE)
  const current = sectionText(next, CURRENT_HEADING, SUPERSEDED_HEADING)
  const superseded = sectionText(next, SUPERSEDED_HEADING, '')
  assert.equal(current.includes(OLD_LINE), false)
  assert.equal(current.includes(KEEP_LINE), true)
  assert.equal(current.includes(NEW_LINE), true)
  assert.equal(superseded.includes(OLD_LINE), true)
  assert.equal(next.includes(OLD_FILE), true)
})

test('sees a short id in the current or superseded section', () => {
  const line = '- 2026-10-18 a1b2c3d4 原来的一句 2026-10-18-a1b2c3d4.md'
  const current = [
    '# 决策索引', '', CURRENT_HEADING, '', line, '', SUPERSEDED_HEADING, '',
  ].join('\n')
  const superseded = [
    '# 决策索引', '', CURRENT_HEADING, '', SUPERSEDED_HEADING, '', line, '',
  ].join('\n')
  assert.equal(decisionIndexHasShortId(current, 'a1b2c3d4'), true)
  assert.equal(decisionIndexHasShortId(superseded, 'a1b2c3d4'), true)
  assert.equal(decisionIndexHasShortId(current, 'deadbeef'), false)
})

test('appends one log index line and does not add sections', () => {
  const first = appendLogIndex('', '- 2026-10-18 a1b2c3d4 核对了验收题')
  const second = appendLogIndex(first, '- 2026-10-18 deadbeef 第二句')
  assert.equal(logIndexHasShortId(second, 'a1b2c3d4'), true)
  assert.equal(second.includes(CURRENT_HEADING), false)
  assert.equal(second.includes('第二句'), true)
})

function sectionText(text, heading, nextHeading) {
  const start = text.indexOf(heading)
  const end = nextHeading ? text.indexOf(nextHeading) : text.length
  return text.slice(start, end)
}

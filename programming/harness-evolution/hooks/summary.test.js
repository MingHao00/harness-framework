'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseModelSummary, redactSummary, toIndexSentence } = require('./summary')
const { EMPTY_FIELD, INDEX_SUMMARY_MAX_CHARS } = require('./constants')
const { SessionRecordError } = require('./errors')

test('parses a fenced JSON object and drops empty decisions', () => {
  const raw = [
    '```json',
    JSON.stringify({
      hasWork: true,
      did: '核对了验收题。后面不进索引',
      paths: ['design\\05.md'],
      unfinished: '',
      hasDecision: true,
      failed: '',
      next: '先改期望',
      commands: '',
      decisions: [{ chose: '无', rejected: '', why: '', reopenWhen: '' }],
      supersedes: 'Decision/2026-10-01-bbbbbbbb.md',
    }),
    '```',
  ].join('\n')
  const summary = parseModelSummary(raw)
  assert.equal(summary.hasWork, true)
  assert.equal(summary.hasDecision, false)
  assert.deepEqual(summary.paths, ['design/05.md'])
  assert.equal(summary.supersedes, '2026-10-01-bbbbbbbb.md')
  assert.equal(toIndexSentence(summary.did), '核对了验收题')
})

test('rejects text that is not the expected object', () => {
  assert.throws(() => parseModelSummary('hello'), SessionRecordError)
  assert.throws(() => parseModelSummary('{"hasWork":"yes"}'), SessionRecordError)
  assert.equal(parseModelSummary('{"hasWork":false}').hasWork, false)
})

test('redacts secrets that the model copied into fields', () => {
  const summary = redactSummary(parseModelSummary(JSON.stringify({
    hasWork: true,
    did: '留下了 sk-realsecretvalue',
    paths: [],
    hasDecision: false,
    decisions: [],
  })))
  assert.equal(summary.did.includes('sk-realsecretvalue'), false)
})

test('cuts an index sentence at the named limit', () => {
  const sentence = toIndexSentence('甲'.repeat(INDEX_SUMMARY_MAX_CHARS + 5))
  assert.equal(sentence.length, INDEX_SUMMARY_MAX_CHARS)
  assert.equal(toIndexSentence(''), EMPTY_FIELD)
})

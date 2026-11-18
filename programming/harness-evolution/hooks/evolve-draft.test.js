'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { SessionRecordError } = require('./errors')
const { FAIL_BAD_MODEL, REDACTED_MARK } = require('./constants')
const {
  parseDraftItems,
  pendingNotice,
  pendingPayload,
  draftPayload,
} = require('./evolve-draft')

const SOURCE = 'C:/talk.jsonl'

test('keeps a complete item and forces the transcript source', () => {
  const raw = JSON.stringify({
    items: [{
      file: '.cursor/hooks/evaluate-session.js',
      category: 'user_corrections',
      what: '抽取钩子',
      change: '只写草稿',
      check: 'status 为 draft',
      source: 'model-made-up',
    }],
  })
  const items = parseDraftItems(raw, SOURCE)
  assert.equal(items.length, 1)
  assert.equal(items[0].source, SOURCE)
  assert.equal(items[0].category, 'user_corrections')
})

test('drops incomplete rows and unknown categories', () => {
  const raw = JSON.stringify({
    items: [
      { file: 'a.js', category: 'user_corrections', what: '', change: 'x', check: 'y' },
      { file: 'b.js', category: 'guess', what: 'w', change: 'c', check: 'k' },
      {
        file: '.cursor/skills/learned/react/SKILL.md',
        category: 'framework_pitfalls',
        what: '列表 key',
        change: '渲染前补稳定 key',
        check: '技能里写了这条',
      },
    ],
  })
  const items = parseDraftItems(raw, SOURCE)
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'framework_pitfalls')
})

test('redacts secrets that the model copied into a draft', () => {
  const secret = 'api_key=abcdefgh'
  const raw = JSON.stringify({
    items: [{
      file: 'a.js',
      category: 'default_approaches',
      what: secret,
      change: '不再写出密钥',
      check: '文件里没有密钥',
    }],
  })
  const items = parseDraftItems(raw, SOURCE)
  assert.equal(items[0].what.includes('abcdefgh'), false)
  assert.match(items[0].what, new RegExp(REDACTED_MARK))
})

test('rejects text that is not a JSON object', () => {
  assert.throws(() => parseDraftItems('nope', SOURCE), SessionRecordError)
  assert.throws(() => parseDraftItems('[]', SOURCE), (error) => error.reason === FAIL_BAD_MODEL)
})

test('pending notice follows draft items or a transcript path', () => {
  const draft = draftPayload({
    transcriptPath: SOURCE,
    messageCount: 12,
    learnedSkillsPath: 'learned',
  }, [{ file: 'a.js' }])
  const pending = pendingPayload({
    transcriptPath: SOURCE,
    messageCount: 12,
    learnedSkillsPath: 'learned',
  })
  assert.match(pendingNotice(JSON.stringify(draft)).found, /草稿/)
  assert.match(pendingNotice(JSON.stringify(pending)).found, /抽取/)
  assert.match(pendingNotice('{').next, /按转录起草/)
})

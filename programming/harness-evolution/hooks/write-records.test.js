'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { persistRecords } = require('./write-records')
const { SHORT_ID_LENGTH } = require('./constants')

const DATE = '2026-10-18'
const MINUTE = '2026-10-18 12:42'
const PARALLEL_SESSIONS = 8

test('keeps every section when the same day is written together', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'session-record-'))
  try {
    const ids = Array.from({ length: PARALLEL_SESSIONS }, (_, index) => (
      String(index).padStart(SHORT_ID_LENGTH, 'a')
    ))
    await Promise.all(ids.map((shortId) => persistRecords(repo, fieldsFor(shortId))))
    const log = await fs.readFile(path.join(repo, 'log', `${DATE}.md`), 'utf8')
    const index = await fs.readFile(path.join(repo, 'Decision', 'index.md'), 'utf8')
    for (const shortId of ids) {
      assert.equal(log.split(`<!-- session:${shortId} -->`).length - 1, 1)
      assert.equal(countLines(index, shortId), 1)
      const body = await fs.readFile(
        path.join(repo, 'Decision', `${DATE}-${shortId}.md`),
        'utf8',
      )
      assert.equal(body.includes(`定了 ${shortId}`), true)
    }
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
})

function fieldsFor(shortId) {
  return {
    hasWork: true,
    did: `做了 ${shortId}`,
    paths: [],
    unfinished: '',
    hasDecision: true,
    failed: '',
    next: '',
    commands: '',
    decisions: [{
      chose: `定了 ${shortId}`,
      rejected: '没定',
      why: '要分开记',
      reopenWhen: '无',
    }],
    supersedes: '',
    date: DATE,
    minute: MINUTE,
    shortId,
  }
}

function countLines(text, shortId) {
  const pattern = new RegExp(`^- \\d{4}-\\d{2}-\\d{2} ${shortId}(?:\\s|$)`, 'gm')
  return (text.match(pattern) || []).length
}

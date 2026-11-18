'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode, isolatedEnv } = require('./spawn-hook')
const { getDateString } = require('./lib/utils')

const END_SCRIPT = path.join(__dirname, 'session-end.js')
const COMPACT_SCRIPT = path.join(__dirname, 'pre-compact.js')
const START_SCRIPT = path.join(__dirname, 'session-start.js')
const SENTINEL = '**Last Updated:** SENTINEL'

test('session end creates a file and then refreshes the timestamp', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'session-end-'))
  try {
    const created = runNode(END_SCRIPT, { env: isolatedEnv(home) })
    assert.equal(created.status, 0, created.stderr)
    assert.match(created.stderr, /Created session file/)
    const sessionFile = path.join(home, '.cursor', 'sessions', `${getDateString()}-session.tmp`)
    const text = await fs.readFile(sessionFile, 'utf8')
    assert.match(text, /# Session:/)
    assert.match(text, /\*\*Last Updated:\*\* \d{2}:\d{2}/)
    await fs.writeFile(sessionFile, text.replace(/\*\*Last Updated:\*\*.*/, SENTINEL), 'utf8')
    const updated = runNode(END_SCRIPT, { env: isolatedEnv(home) })
    assert.match(updated.stderr, /Updated session file/)
    const next = await fs.readFile(sessionFile, 'utf8')
    assert.equal(next.includes('SENTINEL'), false)
    assert.match(next, /\*\*Last Updated:\*\* \d{2}:\d{2}/)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('session end does not rewrite a directory occupying the session path', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'session-dir-'))
  try {
    const sessionFile = path.join(home, '.cursor', 'sessions', `${getDateString()}-session.tmp`)
    await fs.mkdir(sessionFile, { recursive: true })
    const result = runNode(END_SCRIPT, { env: isolatedEnv(home) })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr.includes('Updated session file'), false)
    assert.equal(result.stderr.includes('Created session file'), false)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('lifecycle hooks exit cleanly when the session directory cannot be created', async () => {
  const homes = await Promise.all([
    fs.mkdtemp(path.join(os.tmpdir(), 'session-block-')),
    fs.mkdtemp(path.join(os.tmpdir(), 'compact-block-')),
    fs.mkdtemp(path.join(os.tmpdir(), 'start-block-')),
  ])
  try {
    for (const home of homes) {
      await fs.writeFile(path.join(home, '.cursor'), 'not-a-directory', 'utf8')
    }
    const ended = runNode(END_SCRIPT, { env: isolatedEnv(homes[0]) })
    const compacted = runNode(COMPACT_SCRIPT, { env: isolatedEnv(homes[1]) })
    const started = runNode(START_SCRIPT, { env: isolatedEnv(homes[2]) })
    assert.match(ended.stderr, /\[SessionEnd\] Error:/)
    assert.match(compacted.stderr, /\[PreCompact\] Error:/)
    assert.match(started.stderr, /\[SessionStart\] Error:/)
    for (const result of [ended, compacted, started]) {
      assert.equal(result.status, 0)
    }
  } finally {
    await Promise.all(homes.map((home) => fs.rm(home, { recursive: true, force: true })))
  }
})

test('pre-compact records the event on the newest session', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pre-compact-'))
  const sessions = path.join(home, '.cursor', 'sessions')
  try {
    const older = path.join(sessions, 'older.tmp')
    const newer = path.join(sessions, 'newer.tmp')
    await fs.mkdir(sessions, { recursive: true })
    await fs.writeFile(older, 'old', 'utf8')
    await fs.writeFile(newer, 'new', 'utf8')
    const oldTime = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(older, oldTime, oldTime)
    const marked = runNode(COMPACT_SCRIPT, { env: isolatedEnv(home) })
    assert.equal(marked.status, 0, marked.stderr)
    assert.match(marked.stderr, /State saved before compaction/)
    assert.match(await fs.readFile(newer, 'utf8'), /Compaction occurred at/)
    assert.equal(await fs.readFile(older, 'utf8'), 'old')
    const logPath = path.join(sessions, 'compaction-log.txt')
    assert.match(await fs.readFile(logPath, 'utf8'), /Context compaction triggered/)
    const quietHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pre-compact-empty-'))
    try {
      const quiet = runNode(COMPACT_SCRIPT, { env: isolatedEnv(quietHome) })
      assert.match(quiet.stderr, /State saved before compaction/)
      const quietLog = path.join(quietHome, '.cursor', 'sessions', 'compaction-log.txt')
      assert.match(await fs.readFile(quietLog, 'utf8'), /Context compaction triggered/)
    } finally {
      await fs.rm(quietHome, { recursive: true, force: true })
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

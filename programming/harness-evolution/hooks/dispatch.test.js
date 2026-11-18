'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { handleHook } = require('./dispatch')
const { pickRepoRoot } = require('./session-flow')
const { listPending } = require('./pending')

const OLD_ID = 'aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa'
const NEW_ID = 'bbbbbbbb-2222-4333-8444-bbbbbbbbbbbb'
const NO_WORK = JSON.stringify({
  hasWork: false,
  did: '',
  paths: [],
  unfinished: '',
  hasDecision: false,
  failed: '',
  next: '',
  commands: '',
  decisions: [],
  supersedes: '',
})

test('normalizes the extra slash Cursor puts before a Windows drive', () => {
  assert.equal(pickRepoRoot({ workspace_roots: ['<WORKSPACE>'] }, 'C:\\other'), '<WORKSPACE>')
})

test('stop stores the transcript and does not call the model', async () => {
  const repo = await makeRepo()
  const calls = []
  const result = await handleHook(stopInput(repo, OLD_ID), options(repo, calls))
  assert.equal(result.status, 'pending')
  assert.equal(calls.length, 0)
  const pending = await listPending(repo)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].sessionId, OLD_ID)
  await fs.rm(repo, { recursive: true, force: true })
})

test('a prompt that asks to write the log flushes the current pending session', async () => {
  const repo = await makeRepo()
  const calls = []
  await handleHook(stopInput(repo, OLD_ID), options(repo, calls))
  const result = await handleHook({
    hook_event_name: 'beforeSubmitPrompt',
    prompt: '请补写工作日志',
    session_id: OLD_ID,
    transcript_path: `${repo}\\trial.jsonl`,
  }, options(repo, calls))
  assert.equal(result.continue, true)
  assert.equal(result.status, 'flushed')
  assert.equal(calls.length, 1)
  assert.deepEqual(await listPending(repo), [])
  await fs.rm(repo, { recursive: true, force: true })
})

test('other prompts do not flush', async () => {
  const repo = await makeRepo()
  const calls = []
  await handleHook(stopInput(repo, OLD_ID), options(repo, calls))
  const result = await handleHook({
    hook_event_name: 'beforeSubmitPrompt',
    prompt: '今天的日志写了什么',
    session_id: OLD_ID,
  }, options(repo, calls))
  assert.equal(result.status, 'ignored')
  assert.equal(calls.length, 0)
  assert.equal((await listPending(repo)).length, 1)
  await fs.rm(repo, { recursive: true, force: true })
})

test('workspaceOpen flushes the current pending session', async () => {
  const repo = await makeRepo()
  const calls = []
  await handleHook(stopInput(repo, OLD_ID), options(repo, calls))
  const result = await handleHook({ hook_event_name: 'workspaceOpen' }, options(repo, calls))
  assert.equal(result.status, 'flushed')
  assert.equal(calls.length, 1)
  assert.deepEqual(await listPending(repo), [])
  await fs.rm(repo, { recursive: true, force: true })
})

test('unparseable hook input is ignored and does not write an error file', async () => {
  const repo = await makeRepo()
  const calls = []
  const inputs = [null, [], 'not-json', 1]
  for (const input of inputs) {
    const result = await handleHook(input, options(repo, calls))
    assert.equal(result.status, 'ignored')
  }
  assert.equal(calls.length, 0)
  const errorDir = path.join(repo, 'log', 'errors')
  await assert.rejects(fs.access(errorDir), { code: 'ENOENT' })
  await fs.rm(repo, { recursive: true, force: true })
})

test('sessionStart writes the previous conversation and keeps the new one pending', async () => {
  const repo = await makeRepo()
  const calls = []
  await handleHook(stopInput(repo, OLD_ID), options(repo, calls))
  await handleHook(stopInput(repo, NEW_ID), options(repo, calls))
  const result = await handleHook({
    hook_event_name: 'sessionStart',
    session_id: NEW_ID,
  }, options(repo, calls))
  assert.equal(result.status, 'flushed')
  assert.equal(calls.length, 1)
  const pending = await listPending(repo)
  assert.deepEqual(pending.map((item) => item.sessionId), [NEW_ID])
  await fs.rm(repo, { recursive: true, force: true })
})

async function makeRepo() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'session-dispatch-'))
  const transcript = path.join(repo, 'trial.jsonl')
  const line = JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: '改了 .cursor/hooks/session-record.js' }] },
  })
  await fs.writeFile(transcript, `${line}\n`, 'utf8')
  return repo
}

function stopInput(repo, sessionId) {
  return {
    hook_event_name: 'stop',
    session_id: sessionId,
    transcript_path: path.join(repo, 'trial.jsonl'),
  }
}

function options(repo, calls) {
  return {
    repoRoot: repo,
    env: { SESSION_LOG_API_KEY: 'test-key' },
    completeChat: async () => {
      calls.push('model')
      return NO_WORK
    },
    notify: async () => {},
  }
}

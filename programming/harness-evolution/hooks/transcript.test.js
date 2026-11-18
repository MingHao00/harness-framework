'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { prepareTranscript, truncateTail, resolveTranscriptPath } = require('./transcript')
const { REDACTED_MARK, TRANSCRIPT_ENV_NAME } = require('./constants')

const TAIL_LIMIT = 12
const HEAD_MARK = 'HEAD-MARK-'
const TAIL_MARK = 'TAIL-MARK'
const SK_SECRET = 'sk-realsecretvalue'
const PROFILE = '<USER_HOME>'
const CONVERSATION = 'a1b2c3d4-1111-4222-8333-abcdefabcdef'

test('keeps only text parts and redacts secrets', () => {
  const jsonl = [
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          { type: 'text', text: `密钥 ${SK_SECRET}` },
          { type: 'tool_use', name: 'Shell', input: { command: 'echo skip-me' } },
        ],
      },
    }),
    'not-json',
    JSON.stringify({
      role: 'assistant',
      message: { content: [{ type: 'text', text: '已改 design/01.md' }] },
    }),
  ].join('\n')
  const text = prepareTranscript(jsonl)
  assert.equal(text.includes(SK_SECRET), false)
  assert.equal(text.includes(REDACTED_MARK), true)
  assert.equal(text.includes('echo skip-me'), false)
  assert.equal(text.includes('已改 design/01.md'), true)
  assert.equal(text.includes('user:'), true)
})

test('drops the head and keeps the tail', () => {
  const text = `${HEAD_MARK}${'x'.repeat(TAIL_LIMIT)}${TAIL_MARK}`
  const trimmed = truncateTail(text, TAIL_LIMIT)
  assert.equal(trimmed.length, TAIL_LIMIT)
  assert.equal(trimmed.includes(HEAD_MARK), false)
  assert.equal(trimmed.endsWith(TAIL_MARK), true)
})

test('prefers stdin path, then env, then the conversation file', () => {
  const stdinPath = 'C:\\tmp\\stdin.jsonl'
  const envPath = 'C:\\tmp\\env.jsonl'
  const fallback = path.join(
    PROFILE,
    '.cursor',
    'projects',
    'harness',
    'agent-transcripts',
    CONVERSATION,
    `${CONVERSATION}.jsonl`,
  )
  const present = new Set([envPath, fallback])
  const io = { exists: (filePath) => present.has(filePath), userProfile: PROFILE }
  const input = { transcript_path: stdinPath, session_id: CONVERSATION }
  assert.equal(
    resolveTranscriptPath(input, { [TRANSCRIPT_ENV_NAME]: envPath }, io),
    envPath,
  )
  present.add(stdinPath)
  assert.equal(
    resolveTranscriptPath(input, { [TRANSCRIPT_ENV_NAME]: envPath }, io),
    stdinPath,
  )
  present.delete(stdinPath)
  present.delete(envPath)
  assert.equal(resolveTranscriptPath(input, {}, io), fallback)
})

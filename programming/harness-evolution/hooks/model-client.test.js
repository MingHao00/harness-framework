'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { completeChat } = require('./model-client')
const { SYSTEM_PROMPT } = require('./prompt')
const {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  COMPLETIONS_PATH,
  ENV_KEY_NAME,
  ENV_BASE_URL_NAME,
  ENV_MODEL_NAME,
  FAIL_NO_KEY,
  FAIL_NETWORK,
  FAIL_TIMEOUT,
  BEARER_SCHEME,
} = require('./constants')

const FAKE_KEY = 'test-key-not-real'
const ALT_BASE = 'https://example.test/v1'
const ALT_MODEL = 'deepseek-chat-test'

test('posts to the default chat completions endpoint without calling the network', async () => {
  const seen = []
  const text = await completeChat({
    env: { [ENV_KEY_NAME]: FAKE_KEY },
    prompt: '只返回 JSON',
    fetchImpl: async (url, options) => {
      seen.push({ url, options })
      return {
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"hasWork":false}' } }] }),
      }
    },
  })
  assert.equal(text, '{"hasWork":false}')
  assert.equal(seen[0].url, `${DEFAULT_BASE_URL}${COMPLETIONS_PATH}`)
  assert.equal(seen[0].options.headers.Authorization, `${BEARER_SCHEME} ${FAKE_KEY}`)
  const body = JSON.parse(seen[0].options.body)
  assert.equal(body.model, DEFAULT_MODEL)
  assert.equal(body.messages[0].content, SYSTEM_PROMPT)
  assert.deepEqual(body.thinking, { type: 'disabled' })
})

test('uses a caller system prompt when the session recorder prompt would be wrong', async () => {
  let seenSystem = ''
  await completeChat({
    env: { [ENV_KEY_NAME]: FAKE_KEY },
    system: '只返回 items',
    prompt: 'prompt',
    fetchImpl: async (_url, options) => {
      seenSystem = JSON.parse(options.body).messages[0].content
      return {
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"items":[]}' } }] }),
      }
    },
  })
  assert.equal(seenSystem, '只返回 items')
})

test('honors base URL and model overrides', async () => {
  let seenUrl = ''
  let seenModel = ''
  await completeChat({
    env: {
      [ENV_KEY_NAME]: FAKE_KEY,
      [ENV_BASE_URL_NAME]: `${ALT_BASE}/`,
      [ENV_MODEL_NAME]: ALT_MODEL,
    },
    prompt: 'prompt',
    fetchImpl: async (url, options) => {
      seenUrl = url
      seenModel = JSON.parse(options.body).model
      return {
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"hasWork":false}' } }] }),
      }
    },
  })
  assert.equal(seenUrl, `${ALT_BASE}${COMPLETIONS_PATH}`)
  assert.equal(seenModel, ALT_MODEL)
})

test('failure messages do not include the key', async () => {
  await assert.rejects(
    completeChat({ env: {}, prompt: 'x', fetchImpl: async () => ({}) }),
    (error) => error.reason === FAIL_NO_KEY && !String(error.reason).includes(FAKE_KEY),
  )
  await assert.rejects(
    completeChat({
      env: { [ENV_KEY_NAME]: FAKE_KEY },
      prompt: 'x',
      fetchImpl: async () => {
        throw Object.assign(new Error(FAKE_KEY), { name: 'TimeoutError' })
      },
    }),
    (error) => error.reason === FAIL_TIMEOUT && !error.reason.includes(FAKE_KEY),
  )
  await assert.rejects(
    completeChat({
      env: { [ENV_KEY_NAME]: FAKE_KEY },
      prompt: 'x',
      fetchImpl: async () => {
        throw new Error(`down ${FAKE_KEY}`)
      },
    }),
    (error) => error.reason === FAIL_NETWORK && !error.reason.includes(FAKE_KEY),
  )
})

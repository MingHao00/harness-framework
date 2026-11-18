'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { redactSecrets } = require('./redact')
const { REDACTED_MARK } = require('./constants')

const SK_SECRET = 'sk-realsecretvalue'
const BEARER_SECRET = 'abcdefghijklmnop'
const API_KEY_SECRET = 'supersecretvalue'
const TOKEN_SECRET = 'tok-abcdef'

test('redacts sk, bearer, api_key, and token on repeated calls', () => {
  const source = [
    `密钥 ${SK_SECRET} 不要写`,
    `Bearer ${BEARER_SECRET}`,
    `api_key=${API_KEY_SECRET}`,
    `token: ${TOKEN_SECRET}`,
  ].join(' ')
  const first = redactSecrets(source)
  const second = redactSecrets(source)
  for (const secret of [SK_SECRET, BEARER_SECRET, API_KEY_SECRET, TOKEN_SECRET]) {
    assert.equal(first.includes(secret), false)
    assert.equal(second.includes(secret), false)
  }
  assert.equal(first.includes(REDACTED_MARK), true)
  assert.equal(first.includes('不要写'), true)
})

test('redacts quoted json secret values and leaves the word password', () => {
  const source = [
    '"password":"hunter2abcd"',
    '"api_key": "supersecretvalue"',
    '"api-key":"anothersecretvalue"',
    '"token": "tok-abcdef"',
    '"secret":"s3cr3tvalue"',
    '"password": "hunter two abcd"',
  ].join('\n')
  const first = redactSecrets(source)
  const second = redactSecrets(source)
  const secrets = [
    'hunter2abcd',
    'supersecretvalue',
    'anothersecretvalue',
    'tok-abcdef',
    's3cr3tvalue',
    'hunter two abcd',
  ]
  for (const secret of secrets) {
    assert.equal(first.includes(secret), false)
    assert.equal(second.includes(secret), false)
  }
  assert.equal(first.includes(`"password":"${REDACTED_MARK}"`), true)
  assert.equal(first.includes(`"api_key": "${REDACTED_MARK}"`), true)
  const prose = 'Choose a password before you continue'
  assert.equal(redactSecrets(prose), prose)
  const note = '{"note":"password reset flow for users"}'
  assert.equal(redactSecrets(note), note)
})

test('redacts secret values that contain quotes', () => {
  const assigned = 'password="it\'s-secret-value"'
  const embedded = '"password":"abcd\'efgh"'
  const escaped = JSON.stringify({
    password: 'ab"cd\'efgh',
    user: 'keep-this-name',
  })
  const escapedOut = JSON.stringify({
    password: REDACTED_MARK,
    user: 'keep-this-name',
  })
  const prose = 'Choose a password before you continue'
  assert.equal(redactSecrets(assigned), `password="${REDACTED_MARK}"`)
  assert.equal(redactSecrets(embedded), `"password":"${REDACTED_MARK}"`)
  assert.equal(redactSecrets(escaped), escapedOut)
  assert.equal(redactSecrets(escaped), escapedOut)
  assert.equal(redactSecrets(prose), prose)
})

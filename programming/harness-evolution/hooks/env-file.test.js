'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { loadEnvFile } = require('./env-file')
const { ENV_KEY_NAME, ENV_MODEL_NAME } = require('./constants')

test('fills only missing allowed keys and ignores other secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-env-'))
  await fs.writeFile(path.join(dir, '.env'), [
    '# comment',
    `${ENV_KEY_NAME}=from-dotenv`,
    `${ENV_MODEL_NAME}="from-model"`,
    'OTHER_SECRET=do-not-load',
    `export ${ENV_KEY_NAME}=should-not-override`,
  ].join('\n'), 'utf8')
  const env = { [ENV_KEY_NAME]: 'already-set' }
  loadEnvFile(dir, env)
  assert.equal(env[ENV_KEY_NAME], 'already-set')
  assert.equal(env[ENV_MODEL_NAME], 'from-model')
  assert.equal(env.OTHER_SECRET, undefined)
  await fs.rm(dir, { recursive: true, force: true })
})

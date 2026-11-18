'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { toShortId } = require('./short-id')
const { MISSING_SHORT_ID, SHORT_ID_LENGTH } = require('./constants')

const UUID = 'A1B2C3D4-1111-4222-8333-ABCDEFABCDEF'
const UUID_SHORT = 'a1b2c3d4'

test('uses the first eight lowercase hex digits of a UUID', () => {
  assert.equal(toShortId(UUID), UUID_SHORT)
  assert.equal(UUID_SHORT.length, SHORT_ID_LENGTH)
})

test('keeps the first eight safe characters when the id is not a UUID', () => {
  assert.equal(toShortId('not a uuid extra'), 'notauuid')
  assert.equal(toShortId('Plan #12!!'), 'plan12')
})

test('uses a fixed short id when nothing safe remains', () => {
  assert.equal(toShortId(''), MISSING_SHORT_ID)
  assert.equal(toShortId('!!!'), MISSING_SHORT_ID)
  assert.equal(toShortId(null), MISSING_SHORT_ID)
})

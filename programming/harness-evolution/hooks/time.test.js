'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { formatBeijingMinute } = require('./time')

const MINUTE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/

test('formats Beijing calendar day and minute without seconds', () => {
  const afternoon = formatBeijingMinute(new Date('2026-10-18T04:42:00.987Z'))
  assert.equal(afternoon.date, '2026-10-18')
  assert.equal(afternoon.minute, '2026-10-18 12:42')
  assert.match(afternoon.minute, MINUTE_PATTERN)
  assert.equal(afternoon.minute.includes('.'), false)
})

test('uses the Beijing calendar day around midnight UTC', () => {
  const midnight = formatBeijingMinute(new Date('2026-10-17T16:00:00Z'))
  assert.equal(midnight.date, '2026-10-18')
  assert.equal(midnight.minute, '2026-10-18 00:00')
})

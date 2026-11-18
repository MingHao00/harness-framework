'use strict'

const {
  BEIJING_TIME_ZONE,
  HOUR_MIDNIGHT_BUG,
  HOUR_MIDNIGHT,
} = require('./constants')

/**
 * 把时刻格式化成北京时间的日历日，以及到分钟的时间。
 *
 * @param {Date} date 任意时区的瞬时
 * @returns {{ date: string, minute: string }} date 为 YYYY-MM-DD，minute 含小时和分钟
 */
function formatBeijingMinute(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = readTimeParts(parts)
  const hour = values.hour === HOUR_MIDNIGHT_BUG ? HOUR_MIDNIGHT : values.hour
  const dateText = `${values.year}-${values.month}-${values.day}`
  return { date: dateText, minute: `${dateText} ${hour}:${values.minute}` }
}

function readTimeParts(parts) {
  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return values
}

module.exports = { formatBeijingMinute }

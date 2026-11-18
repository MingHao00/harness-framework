'use strict'

const {
  SHORT_ID_LENGTH,
  MISSING_SHORT_ID,
  UUID_PATTERN,
  SAFE_ID_PATTERN,
} = require('./constants')

/**
 * 把对话 id 收成短号。UUID 取前 8 位小写十六进制。
 *
 * @param {unknown} conversationId session_id 或 conversation_id
 * @returns {string} 最多 8 位的安全短号
 */
function toShortId(conversationId) {
  const raw = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!raw) return MISSING_SHORT_ID
  if (UUID_PATTERN.test(raw)) return raw.slice(0, SHORT_ID_LENGTH).toLowerCase()
  const safe = raw.toLowerCase().replace(SAFE_ID_PATTERN, '')
  if (!safe) return MISSING_SHORT_ID
  return safe.slice(0, SHORT_ID_LENGTH)
}

module.exports = { toShortId }

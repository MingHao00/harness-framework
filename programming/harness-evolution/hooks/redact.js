'use strict'

const { SECRET_PATTERNS } = require('./constants')

/**
 * 去掉会进入模型或日志的密钥片段。
 *
 * @param {string} text 原始文本
 * @returns {string} 替换后的文本；非字符串当作空
 */
function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return ''
  let current = text
  for (const rule of SECRET_PATTERNS) {
    // 全局正则会记住 lastIndex，不复位时下一次会漏掉开头的密钥。
    rule.pattern.lastIndex = 0
    current = current.replace(rule.pattern, rule.replacement)
  }
  return current
}

module.exports = { redactSecrets }

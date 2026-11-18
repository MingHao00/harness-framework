'use strict'

class SessionRecordError extends Error {
  /**
   * @param {string} reason 可以写进错误文件的原因，不能含密钥
   */
  constructor(reason) {
    super(reason)
    this.name = 'SessionRecordError'
    this.reason = reason
  }
}

module.exports = { SessionRecordError }

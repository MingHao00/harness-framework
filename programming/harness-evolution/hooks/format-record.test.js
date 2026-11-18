'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { formatWorkSection, formatDecisionDocument } = require('./format-record')
const { EMPTY_FIELD } = require('./constants')

test('writes empty columns as 无 and omits commands that do not matter', () => {
  const section = formatWorkSection({
    shortId: 'a1b2c3d4',
    minute: '2026-10-18 12:42',
    did: '',
    paths: [],
    unfinished: '',
    decisionPath: '',
    failed: '',
    next: '',
    commands: '',
  })
  assert.equal(section.includes(`：${EMPTY_FIELD}`), true)
  assert.equal(section.includes('命令和结果'), false)
  assert.equal(section.includes('<!-- session:a1b2c3d4 -->'), true)
  assert.equal(section.includes('2026-10-18 12:42'), true)
})

test('writes a command line and a supersede line only when present', () => {
  const section = formatWorkSection({
    shortId: 'a1b2c3d4',
    minute: '2026-10-18 12:42',
    did: '跑了检查',
    paths: ['design/05-acceptance.md'],
    unfinished: '无',
    decisionPath: 'Decision/2026-10-18-a1b2c3d4.md',
    failed: '无',
    next: '再跑一次',
    commands: 'node --test 通过，下一步不用再装依赖',
  })
  assert.equal(section.includes('命令和结果：node --test 通过'), true)
  const decision = formatDecisionDocument({
    date: '2026-10-18',
    shortId: 'a1b2c3d4',
    minute: '2026-10-18 12:42',
    supersedes: '',
    decisions: [{
      chose: '一天一份',
      rejected: '一次对话一份日志',
      why: '和现有日志一致',
      reopenWhen: '需要按对话检索全文时',
    }],
  })
  assert.equal(decision.includes('替代：'), false)
  assert.equal(decision.includes('定了什么：一天一份'), true)
})

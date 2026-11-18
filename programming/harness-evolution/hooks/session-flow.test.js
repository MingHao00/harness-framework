'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runSessionRecord } = require('./session-flow')
const { CURRENT_HEADING, SUPERSEDED_HEADING, FAIL_NO_TRANSCRIPT } = require('./constants')

const NOW = new Date('2026-10-18T04:42:00.500Z')
const SESSION_ID = 'a1b2c3d4-1111-4222-8333-abcdefabcdef'
const SHORT_ID = 'a1b2c3d4'
const BEIJING_MINUTE = '2026-10-18 12:42'
const OLD_FILE = '2026-10-01-bbbbbbbb.md'
const OLD_BODY = '旧文件原文标记\n'
const OLD_LINE = `- 2026-10-01 bbbbbbbb 用本地模型 ${OLD_FILE}`
const KEEP_LINE = '- 2026-10-02 cccccccc 另一条保持 2026-10-02-cccccccc.md'
const SK_SECRET = 'sk-realsecretvalue'
const BEARER_SECRET = 'abcdefghijklmnop'
const API_KEY_SECRET = 'supersecretvalue'
const TOKEN_SECRET = 'tok-abcdef'

test('redacts the transcript, stamps Beijing time, and appends', async () => {
  await withRepo(async (repo) => {
    const old = '# 2026-10-18 工作日志\n\n旧段落保持不动\n'
    await fs.mkdir(path.join(repo, 'log'), { recursive: true })
    await fs.writeFile(logPath(repo), old, 'utf8')
    const transcriptPath = await putTranscript(repo, secretLines())
    const reply = workSummary({ did: `核对了验收题。留下 ${SK_SECRET}` })
    const { result, notes } = await execute(repo, { transcriptPath, reply })
    const log = await fs.readFile(logPath(repo), 'utf8')
    assert.equal(result.status, 'written')
    assert.equal(log.startsWith(old), true)
    assert.ok(log.indexOf('旧段落保持不动') < log.indexOf(`<!-- session:${SHORT_ID} -->`))
    assert.match(log, new RegExp(BEIJING_MINUTE))
    assert.equal(log.includes(SK_SECRET), false)
    assert.equal(log.includes('命令和结果'), false)
    assertNoSecrets(notes.prompts[0])
    assert.equal(notes.prompts[0].includes('echo skip-me'), false)
    assert.equal(notes.notices.length, 0)
    const index = await fs.readFile(path.join(repo, 'log', 'index.md'), 'utf8')
    assert.equal(index.includes('核对了验收题'), true)
    assert.equal(index.includes('留下'), false)
    assert.equal(index.includes(CURRENT_HEADING), false)
  })
})

test('does not append the same session twice', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, plainLines())
    const reply = workSummary()
    const first = await execute(repo, { transcriptPath, reply })
    const written = await fs.readFile(logPath(repo), 'utf8')
    const second = await execute(repo, { transcriptPath, reply })
    const again = await fs.readFile(logPath(repo), 'utf8')
    assert.equal(first.result.status, 'written')
    assert.equal(second.result.status, 'duplicate')
    assert.equal(again, written)
    assert.equal(second.notes.prompts.length, 0)
    assert.equal(again.split(`<!-- session:${SHORT_ID} -->`).length - 1, 1)
  })
})

test('moves a current decision to superseded without deleting the file', async () => {
  await withRepo(async (repo) => {
    await seedOldDecision(repo)
    const transcriptPath = await putTranscript(repo, plainLines())
    const { notes } = await execute(repo, { transcriptPath, reply: decisionReply() })
    const old = await fs.readFile(path.join(repo, 'Decision', OLD_FILE), 'utf8')
    const created = await fs.readFile(decisionPath(repo), 'utf8')
    const index = await fs.readFile(path.join(repo, 'Decision', 'index.md'), 'utf8')
    const current = index.slice(index.indexOf(CURRENT_HEADING), index.indexOf(SUPERSEDED_HEADING))
    const superseded = index.slice(index.indexOf(SUPERSEDED_HEADING))
    assert.equal(old, OLD_BODY)
    assert.equal(created.includes(`替代：${OLD_FILE}`), true)
    assert.equal(current.includes(OLD_LINE), false)
    assert.equal(current.includes(KEEP_LINE), true)
    assert.equal(superseded.includes(OLD_LINE), true)
    assert.equal(index.includes('换电脑时本地模型带不走'), false)
    assert.equal(notes.prompts[0].includes('用本地模型'), true)
    assert.equal(notes.prompts[0].includes('旧文件原文标记'), false)
  })
})

test('writes nothing when the model reports no work', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, plainLines())
    const reply = workSummary({
      hasWork: false,
      hasDecision: true,
      decisions: [{
        chose: '不该写下来',
        rejected: '写下来',
        why: '没有实际工作',
        reopenWhen: '无',
      }],
    })
    const { result, notes } = await execute(repo, { transcriptPath, reply })
    assert.equal(result.status, 'no-work')
    assert.equal(notes.prompts.length, 1)
    assert.equal(notes.notices.length, 0)
    await assert.rejects(fs.access(path.join(repo, 'log')))
    await assert.rejects(fs.access(path.join(repo, 'Decision')))
  })
})

test('records a failure without a work log', async () => {
  await withRepo(async (repo) => {
    const io = { exists: () => false, userProfile: repo }
    const first = await execute(repo, { io, reply: 'not-json' })
    const errorPath = path.join(repo, 'log', 'errors', `2026-10-18-${SHORT_ID}.md`)
    const errorFile = await fs.readFile(errorPath, 'utf8')
    const second = await execute(repo, { io, reply: 'not-json' })
    const appended = await fs.readFile(errorPath, 'utf8')
    assert.equal(first.result.status, 'failed')
    assert.equal(first.result.reason, FAIL_NO_TRANSCRIPT)
    assert.equal(errorFile.includes(BEIJING_MINUTE), true)
    assert.equal(errorFile.includes(SHORT_ID), true)
    assert.equal(errorFile.includes(FAIL_NO_TRANSCRIPT), true)
    assert.equal(appended.startsWith(errorFile), true)
    assert.equal(first.notes.notices.length, 1)
    assert.equal(second.notes.prompts.length, 0)
    await assert.rejects(fs.access(logPath(repo)))
    await assert.rejects(fs.access(path.join(repo, 'Decision')))
  })
})

async function withRepo(run) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'session-record-'))
  assert.equal(repo.startsWith(os.tmpdir()), true)
  try {
    await run(repo)
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
}

async function execute(repo, options) {
  const notes = { prompts: [], notices: [] }
  const result = await runSessionRecord({
    session_id: SESSION_ID,
    transcript_path: options.transcriptPath,
  }, {
    repoRoot: repo,
    env: {},
    now: NOW,
    io: options.io,
    completeChat: async (request) => {
      notes.prompts.push(request.prompt)
      return options.reply
    },
    notify: async (title, message) => {
      notes.notices.push({ title, message })
    },
  })
  return { result, notes }
}

async function putTranscript(repo, lines) {
  const filePath = path.join(repo, 'transcript.jsonl')
  await fs.writeFile(filePath, lines.join('\n'), 'utf8')
  return filePath
}

async function seedOldDecision(repo) {
  const decisionDir = path.join(repo, 'Decision')
  await fs.mkdir(decisionDir, { recursive: true })
  await fs.writeFile(path.join(decisionDir, OLD_FILE), OLD_BODY, 'utf8')
  const index = [
    '# 决策索引', '', CURRENT_HEADING, '', OLD_LINE, KEEP_LINE, '', SUPERSEDED_HEADING, '',
  ].join('\n')
  await fs.writeFile(path.join(decisionDir, 'index.md'), index, 'utf8')
}

function workSummary(overrides) {
  return JSON.stringify({
    hasWork: true,
    did: '核对了验收题。',
    paths: ['design/05-acceptance.md'],
    unfinished: '还没跑评分',
    hasDecision: false,
    failed: '',
    next: '先改期望',
    commands: '',
    decisions: [],
    supersedes: '',
    ...overrides,
  })
}

function decisionReply() {
  return workSummary({
    hasDecision: true,
    did: '换成远端嵌入。',
    commands: 'node --test 已通过，下一步不用再装',
    supersedes: `Decision/${OLD_FILE}`,
    decisions: [{
      chose: '改用远端嵌入',
      rejected: '继续只放本地模型',
      why: '换电脑时本地模型带不走',
      reopenWhen: '必须离线运行时',
    }],
  })
}

function secretLines() {
  return [
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          { type: 'text', text: `密钥 ${SK_SECRET} 不要写进日志` },
          { type: 'tool_use', name: 'Shell', input: { command: 'echo skip-me' } },
        ],
      },
    }),
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: `Bearer ${BEARER_SECRET} api_key=${API_KEY_SECRET} token: ${TOKEN_SECRET}`,
        }],
      },
    }),
  ]
}

function plainLines() {
  return [JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: '讨论了嵌入放在哪' }] },
  })]
}

function assertNoSecrets(prompt) {
  for (const secret of [SK_SECRET, BEARER_SECRET, API_KEY_SECRET, TOKEN_SECRET]) {
    assert.equal(prompt.includes(secret), false)
  }
}

function logPath(repo) {
  return path.join(repo, 'log', '2026-10-18.md')
}

function decisionPath(repo) {
  return path.join(repo, 'Decision', `2026-10-18-${SHORT_ID}.md`)
}

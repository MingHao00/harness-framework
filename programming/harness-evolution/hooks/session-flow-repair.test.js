'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runSessionRecord } = require('./session-flow')
const {
  CURRENT_HEADING,
  SUPERSEDED_HEADING,
  REDACTED_MARK,
} = require('./constants')

const NOW = new Date('2026-10-18T04:42:00.500Z')
const SESSION_ID = 'a1b2c3d4-1111-4222-8333-abcdefabcdef'
const SHORT_ID = 'a1b2c3d4'
const OLD_FILE = '2026-10-01-bbbbbbbb.md'
const OLD_BODY = '旧文件原文标记\n'
const OLD_LINE = `- 2026-10-01 bbbbbbbb 用本地模型 ${OLD_FILE}`
const KEEP_LINE = '- 2026-10-02 cccccccc 另一条保持 2026-10-02-cccccccc.md'
const ORIGINAL_BODY = '已写好的决策正文\n'
const ORIGINAL_LINE = `- 2026-10-18 ${SHORT_ID} 原来的一句 2026-10-18-${SHORT_ID}.md`
const SK_SECRET = 'sk-realsecretvalue'
const JSON_SECRET = 'hunter2abcd'

test('treats a transcript without text as no work', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, [
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Shell', input: {} }] },
      }),
    ])
    const { result, notes } = await execute(repo, { transcriptPath, reply: workSummary() })
    assert.equal(result.status, 'no-work')
    assert.equal(notes.prompts.length, 0)
    assert.equal(notes.notices.length, 0)
    await assert.rejects(fs.access(path.join(repo, 'log')))
    await assert.rejects(fs.access(path.join(repo, 'Decision')))
  })
})

test('appends only the missing work log section', async () => {
  await withRepo(async (repo) => {
    const decisionDir = path.join(repo, 'Decision')
    const logDir = path.join(repo, 'log')
    await fs.mkdir(decisionDir, { recursive: true })
    await fs.mkdir(logDir, { recursive: true })
    await fs.writeFile(path.join(decisionDir, `2026-10-18-${SHORT_ID}.md`), ORIGINAL_BODY, 'utf8')
    const decisionIndex = indexText([ORIGINAL_LINE], [])
    const logIndex = `# 工作日志索引\n\n- 2026-10-18 ${SHORT_ID} 原来的一句\n`
    await fs.writeFile(path.join(decisionDir, 'index.md'), decisionIndex, 'utf8')
    await fs.writeFile(path.join(logDir, 'index.md'), logIndex, 'utf8')
    const transcriptPath = await putTranscript(repo, plainLines())
    await execute(repo, { transcriptPath, reply: decisionReply() })
    const log = await fs.readFile(logPath(repo), 'utf8')
    const nextIndex = await fs.readFile(path.join(decisionDir, 'index.md'), 'utf8')
    const nextLogIndex = await fs.readFile(path.join(logDir, 'index.md'), 'utf8')
    const body = await fs.readFile(path.join(decisionDir, `2026-10-18-${SHORT_ID}.md`), 'utf8')
    assert.equal(log.includes(`<!-- session:${SHORT_ID} -->`), true)
    assert.equal(nextIndex, decisionIndex)
    assert.equal(nextLogIndex, logIndex)
    assert.equal(body, ORIGINAL_BODY)
    await assert.rejects(fs.access(path.join(repo, 'log', 'errors')))
  })
})

test('does not supersede a decision that is not current', async () => {
  await withRepo(async (repo) => {
    await seedIndex(repo, [KEEP_LINE], [OLD_LINE], true)
    const transcriptPath = await putTranscript(repo, plainLines())
    await execute(repo, { transcriptPath, reply: decisionReply() })
    const created = await fs.readFile(decisionPath(repo), 'utf8')
    const index = await fs.readFile(path.join(repo, 'Decision', 'index.md'), 'utf8')
    const current = section(index, CURRENT_HEADING, SUPERSEDED_HEADING)
    const superseded = section(index, SUPERSEDED_HEADING, '')
    assert.equal(created.includes(`替代：${OLD_FILE}`), false)
    assert.equal(current.includes(KEEP_LINE), true)
    assert.equal(current.includes(SHORT_ID), true)
    assert.equal(current.includes(OLD_LINE), false)
    assert.equal(countOf(superseded, OLD_LINE), 1)
    assert.equal(superseded.includes(KEEP_LINE), false)
  })
})

test('does not supersede when the decision file is missing', async () => {
  await withRepo(async (repo) => {
    await seedIndex(repo, [OLD_LINE, KEEP_LINE], [], false)
    const transcriptPath = await putTranscript(repo, plainLines())
    await execute(repo, { transcriptPath, reply: decisionReply() })
    const created = await fs.readFile(decisionPath(repo), 'utf8')
    const index = await fs.readFile(path.join(repo, 'Decision', 'index.md'), 'utf8')
    const current = section(index, CURRENT_HEADING, SUPERSEDED_HEADING)
    const superseded = section(index, SUPERSEDED_HEADING, '')
    assert.equal(created.includes(`替代：${OLD_FILE}`), false)
    assert.equal(current.includes(OLD_LINE), true)
    assert.equal(current.includes(KEEP_LINE), true)
    assert.equal(current.includes(SHORT_ID), true)
    assert.equal(superseded.includes(OLD_LINE), false)
    assert.equal(superseded.includes(KEEP_LINE), false)
  })
})

test('reports a failure when the work log cannot be read', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, plainLines())
    const stderr = []
    const original = process.stderr.write
    process.stderr.write = function capture(chunk, encoding, callback) {
      stderr.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
      return original.call(process.stderr, chunk, encoding, callback)
    }
    try {
      const { result, notes } = await execute(repo, {
        transcriptPath,
        reply: workSummary(),
        readFile: async () => {
          const error = new Error(`EPERM "password":"${JSON_SECRET}" ${SK_SECRET}`)
          error.code = 'EPERM'
          throw error
        },
      })
      const errorPath = path.join(repo, 'log', 'errors', `2026-10-18-${SHORT_ID}.md`)
      const errorFile = await fs.readFile(errorPath, 'utf8')
      const logged = stderr.join('')
      assert.equal(result.status, 'failed')
      assert.equal(notes.notices.length, 1)
      assert.equal(notes.prompts.length, 0)
      assert.equal(errorFile.includes(JSON_SECRET), false)
      assert.equal(errorFile.includes(SK_SECRET), false)
      assert.equal(errorFile.includes(REDACTED_MARK), true)
      assert.equal(logged.includes(JSON_SECRET), false)
      assert.equal(logged.includes(SK_SECRET), false)
      assert.equal(logged.includes('session-record:'), true)
      await assert.rejects(fs.access(logPath(repo)))
      await assert.rejects(fs.access(path.join(repo, 'Decision')))
    } finally {
      process.stderr.write = original
    }
  })
})

async function withRepo(run) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'session-record-'))
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
    readFile: options.readFile,
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

async function seedIndex(repo, currentLines, supersededLines, writeOldFile) {
  const decisionDir = path.join(repo, 'Decision')
  await fs.mkdir(decisionDir, { recursive: true })
  if (writeOldFile) await fs.writeFile(path.join(decisionDir, OLD_FILE), OLD_BODY, 'utf8')
  await fs.writeFile(
    path.join(decisionDir, 'index.md'),
    indexText(currentLines, supersededLines),
    'utf8',
  )
}

function indexText(currentLines, supersededLines) {
  return [
    '# 决策索引',
    '',
    CURRENT_HEADING,
    '',
    ...currentLines,
    '',
    SUPERSEDED_HEADING,
    '',
    ...supersededLines,
    '',
  ].join('\n')
}

function workSummary(overrides) {
  return JSON.stringify({
    hasWork: true,
    did: '核对了验收题。',
    paths: [],
    unfinished: '',
    hasDecision: false,
    failed: '',
    next: '',
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
    supersedes: `Decision/${OLD_FILE}`,
    decisions: [{
      chose: '改用远端嵌入',
      rejected: '继续只放本地模型',
      why: '换电脑时本地模型带不走',
      reopenWhen: '必须离线运行时',
    }],
  })
}

function plainLines() {
  return [JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: '讨论了嵌入放在哪' }] },
  })]
}

function section(text, heading, nextHeading) {
  const start = text.indexOf(heading)
  const end = nextHeading ? text.indexOf(nextHeading) : text.length
  return text.slice(start, end)
}

function countOf(text, line) {
  return text.split(line).length - 1
}

function logPath(repo) {
  return path.join(repo, 'log', '2026-10-18.md')
}

function decisionPath(repo) {
  return path.join(repo, 'Decision', `2026-10-18-${SHORT_ID}.md`)
}

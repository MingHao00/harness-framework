'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode, isolatedEnv } = require('./spawn-hook')
const {
  countUserMessages,
  evaluateTranscript,
  firstText,
  loadConfig,
  resolveLearnedPath,
} = require('./evaluate-session')
const { ENV_KEY_NAME } = require('./constants')

const SCRIPT = path.join(__dirname, 'evaluate-session.js')
const START_SCRIPT = path.join(__dirname, 'session-start.js')
const CONFIG = path.join(__dirname, '..', 'skills', 'continuous-learning', 'config.json')
const LEARNED = path.join(__dirname, '..', 'skills', 'learned')
const DEFAULT_MINIMUM = 10
const PENDING_ENV = 'CONTINUOUS_LEARNING_PENDING'
const LEARNED_ENV = 'CONTINUOUS_LEARNING_LEARNED'

test('config and transcript counts use the documented defaults', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-config-'))
  try {
    const missing = loadConfig(path.join(dir, 'missing.json'))
    assert.equal(missing.minSessionLength, DEFAULT_MINIMUM)
    assert.equal(missing.learnedSkillsPath, LEARNED)
    await fs.writeFile(path.join(dir, 'bad.json'), '{', 'utf8')
    assert.equal(loadConfig(path.join(dir, 'bad.json')).minSessionLength, DEFAULT_MINIMUM)
    await fs.writeFile(
      path.join(dir, 'custom.json'),
      JSON.stringify({ min_session_length: 4, learned_skills_path: '~/skills' }),
      'utf8',
    )
    const custom = loadConfig(path.join(dir, 'custom.json'))
    assert.equal(custom.minSessionLength, 4)
    assert.equal(custom.learnedSkillsPath, '~/skills')
    await fs.writeFile(
      path.join(dir, 'zero.json'),
      JSON.stringify({ min_session_length: 0, learned_skills_path: '' }),
      'utf8',
    )
    const zero = loadConfig(path.join(dir, 'zero.json'))
    assert.equal(zero.minSessionLength, DEFAULT_MINIMUM)
    assert.equal(zero.learnedSkillsPath, LEARNED)
    assert.equal(resolveLearnedPath('~/skills'), `${os.homedir()}/skills`)
    assert.equal(resolveLearnedPath('plain'), 'plain')
    assert.equal(firstText('  cursor  ', 'claude'), 'cursor')
    assert.equal(firstText('   ', '  claude '), 'claude')
    assert.equal(firstText(1, 2), '')
    const both = path.join(dir, 'both.jsonl')
    await fs.writeFile(both, '{"role":"user","type":"user"}\n{"role":"user"}\n', 'utf8')
    assert.equal(countUserMessages(both), 2)
    assert.equal(countUserMessages(path.join(dir, 'missing.jsonl')), 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// 待确认文件和学习目录都放在临时目录，钩子按顺序写同一份文件。
test('session start and length gate share the pending file', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-home-'))
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-work-'))
  const learned = path.join(home, 'learned')
  const pending = path.join(home, 'pending.json')
  try {
    await assertSessionStart(home, learned, pending)
    await fs.rm(pending, { force: true })
    const minimum = loadConfig(CONFIG).minSessionLength
    await assertSkipped(work, home, pending, minimum - 1)
    await assertRecorded(work, home, pending, minimum)
    await assertStdinWins(work, home, pending, minimum)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
    await fs.rm(work, { recursive: true, force: true })
  }
})

test('a model draft is stored and existing learned files stay put', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-draft-'))
  const learned = path.join(work, 'learned')
  const pending = path.join(work, 'pending.json')
  const transcript = path.join(work, 'talk.jsonl')
  const marker = path.join(learned, 'keep.md')
  try {
    await fs.mkdir(learned)
    await fs.writeFile(marker, 'stay\n', 'utf8')
    await fs.writeFile(transcript, `${userText('以后只写草稿')}\n`, 'utf8')
    const result = await evaluateTranscript({
      transcriptPath: transcript,
      minSessionLength: 1,
      learnedSkillsPath: learned,
      pendingPath: pending,
      repoRoot: work,
      env: { [ENV_KEY_NAME]: 'test-key-not-real' },
      fetchImpl: async () => modelReply({
        items: [{
          file: '.cursor/hooks/evaluate-session.js',
          category: 'user_corrections',
          what: '抽取钩子',
          change: '只写草稿',
          check: 'status 为 draft',
          source: 'ignore-me',
        }],
      }),
    })
    assert.equal(result.status, 'draft')
    const saved = JSON.parse(await fs.readFile(pending, 'utf8'))
    assert.equal(saved.status, 'draft')
    assert.equal(saved.items[0].source, transcript)
    assert.equal(await fs.readFile(marker, 'utf8'), 'stay\n')
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
})

test('an empty model reply removes a stale pending file', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-empty-'))
  const pending = path.join(work, 'pending.json')
  const transcript = path.join(work, 'talk.jsonl')
  try {
    await fs.writeFile(pending, '{"status":"draft"}\n', 'utf8')
    await fs.writeFile(transcript, `${userText('没有可记的事')}\n`, 'utf8')
    const result = await evaluateTranscript({
      transcriptPath: transcript,
      minSessionLength: 1,
      learnedSkillsPath: path.join(work, 'learned'),
      pendingPath: pending,
      repoRoot: work,
      env: { [ENV_KEY_NAME]: 'test-key-not-real' },
      fetchImpl: async () => modelReply({ items: [] }),
    })
    assert.equal(result.status, 'empty')
    assert.equal(await exists(pending), false)
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
})

async function assertSessionStart(home, learned, pending) {
  const sessions = path.join(home, '.cursor', 'sessions')
  const skill = path.join(learned, 'skill.md')
  await fs.mkdir(sessions, { recursive: true })
  await fs.writeFile(path.join(sessions, 'note.tmp'), 'session\n', 'utf8')
  await fs.mkdir(learned, { recursive: true })
  await fs.writeFile(skill, '# skill\n', 'utf8')
  await fs.writeFile(pending, '{"status":"pending"}\n', 'utf8')
  const result = runNode(START_SCRIPT, { env: learningEnv(home, learned, pending) })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Found 1 recent session/)
  assert.match(result.stderr, /learned skill/)
  assert.match(result.stderr, /待确认的自进化抽取/)
  assert.match(result.stderr, /按转录起草/)
  assert.match(result.stderr, /Package manager:/)
}

async function assertSkipped(work, home, pending, count) {
  const transcript = await writeUsers(work, 'short.jsonl', count, 'role')
  const missing = runNode(SCRIPT, {
    cwd: work,
    env: learningEnv(home, '', pending),
    input: JSON.stringify({ transcript_path: path.join(work, 'absent.jsonl') }),
  })
  assert.equal(missing.status, 0, missing.stderr)
  assert.equal(missing.stderr, '')
  const result = runNode(SCRIPT, {
    cwd: work,
    env: learningEnv(home, '', pending),
    input: JSON.stringify({ transcript_path: transcript }),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Session too short/)
  assert.equal(await exists(pending), false)
}

async function assertRecorded(work, home, pending, count) {
  const transcript = await writeUsers(work, 'long.jsonl', count, 'type')
  const result = runNode(SCRIPT, {
    cwd: work,
    env: learningEnv(home, '', pending, { CURSOR_TRANSCRIPT_PATH: transcript }),
    input: '',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /只保留转录路径/)
  const saved = JSON.parse(await fs.readFile(pending, 'utf8'))
  assert.equal(saved.transcriptPath, transcript)
  assert.equal(saved.messageCount, count)
  assert.equal(saved.status, 'pending')
  assert.equal(saved.items, undefined)
}

async function assertStdinWins(work, home, pending, count) {
  const short = await writeUsers(work, 'stdin-short.jsonl', 1, 'role')
  const long = await writeUsers(work, 'env-long.jsonl', count, 'role')
  await fs.rm(pending, { force: true })
  const result = runNode(SCRIPT, {
    cwd: work,
    env: learningEnv(home, '', pending, {
      CURSOR_TRANSCRIPT_PATH: long,
      CLAUDE_TRANSCRIPT_PATH: long,
    }),
    input: JSON.stringify({ transcriptPath: short }),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Session too short/)
  assert.equal(await exists(pending), false)
}

function learningEnv(home, learned, pending, extra = {}) {
  const env = isolatedEnv(home, {
    [PENDING_ENV]: pending,
    [LEARNED_ENV]: learned,
    ...extra,
  })
  delete env.SESSION_LOG_API_KEY
  delete env.SESSION_LOG_BASE_URL
  delete env.SESSION_LOG_MODEL
  return env
}

function userText(text) {
  return JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text }] },
  })
}

function modelReply(body) {
  return {
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  }
}

async function writeUsers(dir, name, count, field) {
  const filePath = path.join(dir, name)
  const lines = Array.from({ length: count }, () => `{"${field}":"user"}`)
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
  return filePath
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

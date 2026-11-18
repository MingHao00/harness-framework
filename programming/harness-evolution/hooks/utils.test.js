'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('child_process')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const utils = require('./lib/utils')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^\d{2}:\d{2}$/
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const OLD_TIME = new Date('2020-01-01T00:00:00Z')
const RECENT_DAYS = 1
const ANCIENT_DAYS = 10000
const UTILS_LIB = path.join(__dirname, 'lib', 'utils.js')
const MISSING_COMMAND = 'missing-command-coverage-xyz'

test('directory helpers point at the user and repository locations', () => {
  assert.equal(utils.getHomeDir(), os.homedir())
  assert.equal(utils.getClaudeDir(), path.join(os.homedir(), '.claude'))
  assert.equal(utils.getSessionsDir(), path.join(os.homedir(), '.cursor', 'sessions'))
  assert.equal(utils.getTempDir(), os.tmpdir())
  assert.equal(utils.getLearnedSkillsDir(), path.join(__dirname, '..', 'skills', 'learned'))
  const pending = utils.getContinuousLearningPendingPath()
  assert.equal(pending.endsWith(path.join('continuous-learning', 'pending.json')), true)
  assert.equal(utils.isWindows, process.platform === 'win32')
  assert.equal(utils.isMacOS, process.platform === 'darwin')
  assert.equal(utils.isLinux, process.platform === 'linux')
  const previousPending = process.env.CONTINUOUS_LEARNING_PENDING
  const previousLearned = process.env.CONTINUOUS_LEARNING_LEARNED
  process.env.CONTINUOUS_LEARNING_PENDING = path.join('temp', 'pending.json')
  process.env.CONTINUOUS_LEARNING_LEARNED = path.join('temp', 'learned')
  try {
    assert.equal(utils.getContinuousLearningPendingPath(), path.join('temp', 'pending.json'))
    assert.equal(utils.getLearnedSkillsDir(), path.join('temp', 'learned'))
  } finally {
    restoreEnv('CONTINUOUS_LEARNING_PENDING', previousPending)
    restoreEnv('CONTINUOUS_LEARNING_LEARNED', previousLearned)
  }
})

test('date helpers use the local calendar', () => {
  assert.match(utils.getDateString(), DATE_PATTERN)
  assert.match(utils.getTimeString(), TIME_PATTERN)
  assert.match(utils.getDateTimeString(), DATE_TIME_PATTERN)
})

test('file helpers create, search, and edit text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-utils-'))
  try {
    assert.equal(utils.ensureDir(path.join(dir, 'nested', 'leaf')), path.join(dir, 'nested', 'leaf'))
    assert.equal(utils.ensureDir(path.join(dir, 'nested', 'leaf')), path.join(dir, 'nested', 'leaf'))
    const note = path.join(dir, 'notes', 'a.txt')
    utils.writeFile(note, 'alpha beta')
    utils.appendFile(note, ' gamma')
    assert.equal(utils.readFile(note), 'alpha beta gamma')
    assert.equal(utils.readFile(path.join(dir, 'missing.txt')), null)
    assert.equal(utils.replaceInFile(note, 'beta', 'delta'), true)
    assert.equal(utils.readFile(note), 'alpha delta gamma')
    assert.equal(utils.replaceInFile(path.join(dir, 'missing.txt'), 'a', 'b'), false)
    assert.equal(utils.countInFile(note, 'a'), 5)
    assert.equal(utils.countInFile(note, /al/g), 1)
    assert.equal(utils.countInFile(note, 'missing'), 0)
    assert.equal(utils.countInFile(path.join(dir, 'missing.txt'), 'a'), 0)
    assert.deepEqual(utils.grepFile(note, /delta/), [{ lineNumber: 1, content: 'alpha delta gamma' }])
    assert.deepEqual(utils.grepFile(path.join(dir, 'missing.txt'), /a/), [])
    await writeSearchFixtures(dir)
    assert.deepEqual(names(utils.findFiles(dir, '*.tmp')), ['new.tmp', 'old.tmp'])
    assert.deepEqual(names(utils.findFiles(dir, '*.tmp', { maxAge: RECENT_DAYS })), ['new.tmp'])
    assert.deepEqual(
      names(utils.findFiles(dir, '*.tmp', { maxAge: ANCIENT_DAYS })),
      ['new.tmp', 'old.tmp'],
    )
    assert.deepEqual(names(utils.findFiles(dir, 'n?.txt')), ['n1.txt'])
    assert.deepEqual(names(utils.findFiles(dir, '*.tmp', { recursive: true })), [
      'new.tmp',
      'nested.tmp',
      'old.tmp',
    ])
    assert.deepEqual(utils.findFiles(path.join(dir, 'missing'), '*.tmp'), [])
    assert.deepEqual(utils.findFiles(note, '*.tmp'), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('log and output write to the error and standard streams', () => {
  const logs = []
  const lines = []
  const originalError = console.error
  const originalLog = console.log
  console.error = (line) => logs.push(line)
  console.log = (line) => lines.push(line)
  try {
    utils.log('visible')
    utils.output({ ok: true })
    utils.output('plain')
  } finally {
    console.error = originalError
    console.log = originalLog
  }
  assert.deepEqual(logs, ['visible'])
  assert.deepEqual(lines, ['{"ok":true}', 'plain'])
})

test('command helpers report success and failure', () => {
  assert.equal(utils.commandExists('node'), true)
  assert.equal(utils.commandExists(MISSING_COMMAND), false)
  const sum = utils.runCommand('node -p "40+2"')
  assert.equal(sum.success, true)
  assert.equal(sum.output, '42')
  const failed = utils.runCommand('node -e "process.exit(2)"')
  assert.equal(failed.success, false)
  assert.equal(typeof failed.output, 'string')
})

test('stdin json accepts an object, an empty body, and invalid text', () => {
  const source = `
    const { readStdinJson } = require(${JSON.stringify(UTILS_LIB)})
    readStdinJson().then(
      (value) => process.stdout.write(JSON.stringify(value)),
      (error) => {
        process.stderr.write(error.message)
        process.exit(1)
      },
    )
  `
  const parsed = spawnSync(process.execPath, ['-e', source], { input: '{"a":1}', encoding: 'utf8' })
  assert.equal(parsed.status, 0, parsed.stderr)
  assert.equal(parsed.stdout, '{"a":1}')
  const empty = spawnSync(process.execPath, ['-e', source], { input: '   ', encoding: 'utf8' })
  assert.equal(empty.status, 0, empty.stderr)
  assert.equal(empty.stdout, '{}')
  const invalid = spawnSync(process.execPath, ['-e', source], { input: '{', encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.notEqual(invalid.stderr, '')
})

test('git helpers follow the working directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-git-'))
  const repo = path.join(root, 'repo')
  const unborn = path.join(root, 'unborn')
  const plain = path.join(root, 'plain')
  await fs.mkdir(repo)
  await fs.mkdir(unborn)
  await fs.mkdir(plain)
  try {
    await fs.writeFile(path.join(repo, 'a.js'), 'const value = 1\n', 'utf8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'text\n', 'utf8')
    git(repo, ['init'])
    git(repo, ['add', 'a.js', 'b.txt'])
    git(repo, ['commit', '-m', 'init'])
    await fs.writeFile(path.join(repo, 'a.js'), 'const value = 2\n', 'utf8')
    const changed = readGit(repo)
    assert.equal(changed.repo, true)
    assert.deepEqual(changed.js, ['a.js'])
    assert.deepEqual(changed.none, [])
    assert.deepEqual(changed.all, ['a.js'])
    git(unborn, ['init'])
    const noHead = readGit(unborn)
    assert.equal(noHead.repo, true)
    assert.deepEqual(noHead.all, [])
    const outside = readGit(plain)
    assert.equal(outside.repo, false)
    assert.deepEqual(outside.all, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function writeSearchFixtures(dir) {
  const oldFile = path.join(dir, 'old.tmp')
  const newFile = path.join(dir, 'new.tmp')
  const nested = path.join(dir, 'sub', 'nested.tmp')
  await fs.writeFile(oldFile, 'old')
  await fs.writeFile(newFile, 'new')
  await fs.writeFile(path.join(dir, 'n1.txt'), 'one')
  await fs.writeFile(path.join(dir, 'n12.txt'), 'twelve')
  await fs.mkdir(path.dirname(nested))
  await fs.writeFile(nested, 'nested')
  const middle = new Date('2024-01-01T00:00:00Z')
  await fs.utimes(oldFile, OLD_TIME, OLD_TIME)
  await fs.utimes(nested, middle, middle)
  await fs.utimes(newFile, new Date(), new Date())
}

function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}

function names(files) {
  return files.map((file) => path.basename(file.path))
}

function readGit(repo) {
  const source = [
    "'use strict'",
    `const { getGitModifiedFiles, isGitRepo } = require(${JSON.stringify(UTILS_LIB)})`,
    'process.stdout.write(JSON.stringify({',
    '  repo: isGitRepo(),',
    "  js: getGitModifiedFiles(['\\\\.js$']),",
    "  none: getGitModifiedFiles(['\\\\.absent$']),",
    '  all: getGitModifiedFiles(),',
    '}))',
  ].join('\n')
  const result = spawnSync(process.execPath, ['-e', source], { cwd: repo, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function git(repo, args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'coverage',
      GIT_AUTHOR_EMAIL: 'coverage@example.com',
      GIT_COMMITTER_NAME: 'coverage',
      GIT_COMMITTER_EMAIL: 'coverage@example.com',
    },
  })
  assert.equal(result.status, 0, result.stderr)
}

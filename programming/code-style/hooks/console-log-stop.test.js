'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('child_process')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode } = require('../../harness-evolution/hooks/spawn-hook')

const SCRIPT = path.join(__dirname, 'console-log-stop.js')
const EXTRA_LINE = 6
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'coverage',
  GIT_AUTHOR_EMAIL: 'coverage@example.com',
  GIT_COMMITTER_NAME: 'coverage',
  GIT_COMMITTER_EMAIL: 'coverage@example.com',
}

test('stop hook reports console.log in changed source files', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'console-stop-'))
  try {
    await fs.writeFile(path.join(repo, 'app.js'), 'const value = 1\n', 'utf8')
    await fs.writeFile(path.join(repo, 'note.ts'), 'export {}\n', 'utf8')
    await fs.writeFile(path.join(repo, 'skip.py'), 'value = 1\n', 'utf8')
    await fs.writeFile(path.join(repo, 'gone.js'), 'console.log("gone")\n', 'utf8')
    git(repo, ['init'])
    git(repo, ['add', 'app.js', 'note.ts', 'skip.py', 'gone.js'])
    git(repo, ['commit', '-m', 'init'])
    await writeLogs(path.join(repo, 'app.js'), EXTRA_LINE)
    await fs.writeFile(path.join(repo, 'note.ts'), 'console.log("keep")\n', 'utf8')
    await fs.writeFile(path.join(repo, 'skip.py'), 'console.log("py")\n', 'utf8')
    await fs.rm(path.join(repo, 'gone.js'))
    const result = runNode(SCRIPT, { cwd: repo })
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    const note = payload.additional_context
    assert.match(note, /console\.log found in app\.js/)
    assert.match(note, /console\.log found in note\.ts/)
    assert.match(note, /5: console\.log\(5\)/)
    assert.equal(note.includes('6: console.log(6)'), false)
    assert.equal(note.includes('skip.py'), false)
    assert.equal(note.includes('gone.js'), false)
    assert.match(note, /Remove console\.log before committing/)
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
})

test('stop hook stays quiet when git diff cannot list files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'console-stop-empty-'))
  const bare = path.join(dir, 'plain')
  const unborn = path.join(dir, 'unborn')
  await fs.mkdir(bare)
  await fs.mkdir(unborn)
  try {
    const plain = runNode(SCRIPT, { cwd: bare })
    assert.equal(plain.status, 0, plain.stderr)
    assert.equal(plain.stdout, '')
    git(unborn, ['init'])
    const noHead = runNode(SCRIPT, { cwd: unborn })
    assert.equal(noHead.status, 0, noHead.stderr)
    assert.equal(noHead.stdout, '')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeLogs(filePath, count) {
  const lines = Array.from({ length: count }, (_, index) => `console.log(${index + 1})`)
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: GIT_ENV })
  assert.equal(result.status, 0, result.stderr)
}

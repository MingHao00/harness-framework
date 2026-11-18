'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode, isolatedEnv } = require('../../harness-evolution/hooks/spawn-hook')
const {
  detectFromLockFile,
  detectFromPackageJson,
  getCommandPattern,
  getExecCommand,
  getPackageManager,
  getRunCommand,
  getSelectionPrompt,
  setProjectPackageManager,
} = require('./lib/package-manager')

const PACKAGE_LIB = path.join(__dirname, 'lib', 'package-manager.js')
const ENV_NAME = 'CLAUDE_PACKAGE_MANAGER'

test('lock files and package.json are detected in priority order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-detect-'))
  try {
    assert.equal(await detectLock(root, 'both', ['pnpm-lock.yaml', 'package-lock.json']), 'pnpm')
    assert.equal(await detectLock(root, 'bun', ['bun.lockb']), 'bun')
    assert.equal(await detectLock(root, 'yarn', ['yarn.lock']), 'yarn')
    assert.equal(await detectLock(root, 'npm', ['package-lock.json']), 'npm')
    assert.equal(await detectLock(root, 'none', []), null)
    const pkg = path.join(root, 'pkg')
    await fs.mkdir(pkg)
    assert.equal(detectFromPackageJson(pkg), null)
    await fs.writeFile(path.join(pkg, 'package.json'), '{', 'utf8')
    assert.equal(detectFromPackageJson(pkg), null)
    await fs.writeFile(path.join(pkg, 'package.json'), '{}\n', 'utf8')
    assert.equal(detectFromPackageJson(pkg), null)
    await fs.writeFile(
      path.join(pkg, 'package.json'),
      JSON.stringify({ packageManager: 'not-real@1' }),
      'utf8',
    )
    assert.equal(detectFromPackageJson(pkg), null)
    await fs.writeFile(
      path.join(pkg, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@8.6.0' }),
      'utf8',
    )
    assert.equal(detectFromPackageJson(pkg), 'pnpm')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('command patterns cover each package manager action', () => {
  assert.match(getCommandPattern('dev'), /npm run dev/)
  assert.match(getCommandPattern('dev'), /pnpm\( run\)\? dev/)
  assert.match(getCommandPattern('install'), /yarn\( install\)\?/)
  assert.match(getCommandPattern('test'), /bun test/)
  assert.match(getCommandPattern('build'), /bun run build/)
  assert.match(getCommandPattern('lint'), /npm run lint/)
  assert.match(getCommandPattern('lint'), /pnpm\( run\)\? lint/)
})

test('project preference is written beside the project', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-project-'))
  try {
    assert.throws(
      () => setProjectPackageManager('nope', dir),
      /Unknown package manager: nope/,
    )
    const saved = setProjectPackageManager('bun', dir)
    assert.equal(saved.packageManager, 'bun')
    const file = path.join(dir, '.claude', 'package-manager.json')
    const stored = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(stored.packageManager, 'bun')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// 这些检查会改进程里的包管理器环境变量，必须串行，避免互相覆盖。
test('selection follows env, project, package.json, then the lock file', async () => {
  const previous = process.env[ENV_NAME]
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-priority-'))
  try {
    await checkEnvOverride(root)
    await checkInvalidSignals(root)
    await checkManifestAndLock(root)
    checkCommands()
  } finally {
    restoreEnv(previous)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('global preference stays inside the isolated home directory', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-home-'))
  const empty = path.join(home, 'empty')
  await fs.mkdir(empty)
  try {
    const selected = await runHomeScript(home, empty, `
      const api = require(${JSON.stringify(PACKAGE_LIB)})
      api.setPreferredPackageManager('pnpm')
      const pm = api.getPackageManager({ projectDir: ${JSON.stringify(empty)} })
      process.stdout.write(pm.source + ':' + pm.name)
    `)
    assert.equal(selected, 'global-config:pnpm')
    const broken = path.join(home, '.claude', 'package-manager.json')
    await fs.writeFile(broken, '{', 'utf8')
    const fallback = await runHomeScript(home, empty, `
      const api = require(${JSON.stringify(PACKAGE_LIB)})
      const pm = api.getPackageManager({ projectDir: ${JSON.stringify(empty)} })
      process.stdout.write(pm.source)
    `)
    assert.equal(fallback, 'fallback')
    const rejected = await runHomeScript(home, empty, `
      const api = require(${JSON.stringify(PACKAGE_LIB)})
      try {
        api.setPreferredPackageManager('nope')
        process.stdout.write('unexpected')
      } catch (error) {
        process.stdout.write(error.message)
      }
    `)
    assert.equal(rejected, 'Unknown package manager: nope')
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

async function detectLock(root, name, files) {
  const dir = path.join(root, name)
  await fs.mkdir(dir)
  for (const file of files) {
    await fs.writeFile(path.join(dir, file), '', 'utf8')
  }
  return detectFromLockFile(dir)
}

async function checkEnvOverride(root) {
  setEnv('yarn')
  const dir = await writeProject(root, 'env', {
    '.claude/package-manager.json': JSON.stringify({ packageManager: 'pnpm' }),
  })
  const selected = getPackageManager({ projectDir: dir })
  assert.equal(selected.name, 'yarn')
  assert.equal(selected.source, 'environment')
}

async function checkInvalidSignals(root) {
  setEnv('cargo')
  const project = await writeProject(root, 'cargo', {
    '.claude/package-manager.json': JSON.stringify({ packageManager: 'pnpm' }),
  })
  assert.equal(getPackageManager({ projectDir: project }).source, 'project-config')
  setEnv(undefined)
  const badJson = await writeProject(root, 'bad-json', {
    '.claude/package-manager.json': '{',
    'package.json': JSON.stringify({ packageManager: 'pnpm@8.6.0' }),
  })
  const fromManifest = getPackageManager({ projectDir: badJson })
  assert.equal(fromManifest.name, 'pnpm')
  assert.equal(fromManifest.source, 'package.json')
  const unknown = await writeProject(root, 'unknown', {
    '.claude/package-manager.json': JSON.stringify({ packageManager: 'cargo' }),
    'yarn.lock': '',
  })
  const fromLock = getPackageManager({ projectDir: unknown })
  assert.equal(fromLock.name, 'yarn')
  assert.equal(fromLock.source, 'lock-file')
}

async function checkManifestAndLock(root) {
  setEnv(undefined)
  const both = await writeProject(root, 'both', {
    'package.json': JSON.stringify({ packageManager: 'bun' }),
    'package-lock.json': '',
  })
  const manifest = getPackageManager({ projectDir: both })
  assert.equal(manifest.name, 'bun')
  assert.equal(manifest.source, 'package.json')
  const lock = await writeProject(root, 'lock', { 'package-lock.json': '' })
  const locked = getPackageManager({ projectDir: lock })
  assert.equal(locked.name, 'npm')
  assert.equal(locked.source, 'lock-file')
}

function checkCommands() {
  setEnv('npm')
  assert.equal(getRunCommand('install'), 'npm install')
  assert.equal(getRunCommand('test'), 'npm test')
  assert.equal(getRunCommand('build'), 'npm run build')
  assert.equal(getRunCommand('dev'), 'npm run dev')
  assert.equal(getRunCommand('lint'), 'npm run lint')
  assert.equal(getExecCommand('prettier', '--write a.js'), 'npx prettier --write a.js')
  assert.equal(getExecCommand('prettier'), 'npx prettier')
  setEnv('pnpm')
  assert.equal(getRunCommand('lint'), 'pnpm lint')
  assert.equal(getExecCommand('eslint', 'src'), 'pnpm dlx eslint src')
  const pnpmPrompt = getSelectionPrompt()
  if (pnpmPrompt.includes('\n  - pnpm')) {
    assert.match(pnpmPrompt, /pnpm \(current\)/)
  } else {
    assert.equal(pnpmPrompt.includes('(current)'), false)
  }
  setEnv('npm')
  assert.match(getSelectionPrompt(), /npm \(current\)/)
}

async function writeProject(root, name, files) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
  }
  return dir
}

function setEnv(value) {
  if (value === undefined) delete process.env[ENV_NAME]
  else process.env[ENV_NAME] = value
}

function restoreEnv(previous) {
  if (previous === undefined) delete process.env[ENV_NAME]
  else process.env[ENV_NAME] = previous
}

async function runHomeScript(home, cwd, source) {
  const script = path.join(home, `run-${Math.random().toString(16).slice(2)}.js`)
  await fs.writeFile(script, `'use strict'\n${source}\n`, 'utf8')
  const result = runNode(script, { cwd, env: isolatedEnv(home) })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

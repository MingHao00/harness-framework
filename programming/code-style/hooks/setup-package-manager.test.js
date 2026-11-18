'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { runNode, isolatedEnv } = require('../../harness-evolution/hooks/spawn-hook')

const SCRIPT = path.join(__dirname, 'setup-package-manager.js')

test('help, detection, and the installed list print without saving', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-show-'))
  const project = path.join(home, 'project')
  await fs.mkdir(project)
  try {
    const help = runSetup(home, project, [])
    assert.equal(help.status, 0, help.stderr)
    assert.match(help.stdout, /--detect/)
    const flagged = runSetup(home, project, ['--help'])
    assert.match(flagged.stdout, /--global/)
    const listed = runSetup(home, project, ['--list'])
    assert.equal(listed.status, 0, listed.stderr)
    assert.match(listed.stdout, /npm/)
    assert.match(listed.stdout, /Lock file:/)
    const detected = runSetup(home, project, ['--detect'])
    assert.equal(detected.status, 0, detected.stderr)
    assert.match(detected.stdout, /Current selection:/)
    assert.match(detected.stdout, /not specified/)
    const fromEnv = runSetup(home, project, ['--detect'], { CLAUDE_PACKAGE_MANAGER: 'yarn' })
    assert.match(fromEnv.stdout, /Package Manager: yarn/)
    assert.match(fromEnv.stdout, /Source: environment/)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('global and project preferences reject incomplete choices', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-bad-'))
  const project = path.join(home, 'project')
  await fs.mkdir(project)
  try {
    const cases = [
      ['--global'],
      ['--global', 'nope'],
      ['--project'],
      ['--project', 'nope'],
      ['nope'],
    ]
    for (const args of cases) {
      const result = runSetup(home, project, args)
      assert.equal(result.status, 1, args.join(' '))
    }
    const unknown = runSetup(home, project, ['nope'])
    assert.match(`${unknown.stdout}\n${unknown.stderr}`, /Unknown option or package manager/)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('a named manager can be saved globally or for one project', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-save-'))
  const project = path.join(home, 'project')
  await fs.mkdir(project)
  try {
    const globalChoice = runSetup(home, project, ['--global', 'npm'])
    assert.equal(globalChoice.status, 0, globalChoice.stderr)
    assert.match(globalChoice.stdout, /Global preference set to: npm/)
    const globalFile = path.join(home, '.claude', 'package-manager.json')
    const globalSaved = JSON.parse(await fs.readFile(globalFile, 'utf8'))
    assert.equal(globalSaved.packageManager, 'npm')
    const positional = runSetup(home, project, ['npm'])
    assert.equal(positional.status, 0, positional.stderr)
    const projectChoice = runSetup(home, project, ['--project', 'yarn'])
    assert.equal(projectChoice.status, 0, projectChoice.stderr)
    assert.match(projectChoice.stdout, /Project preference set to: yarn/)
    const projectFile = path.join(project, '.claude', 'package-manager.json')
    const projectSaved = JSON.parse(await fs.readFile(projectFile, 'utf8'))
    assert.equal(projectSaved.packageManager, 'yarn')
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

function runSetup(home, project, args, extra = {}) {
  return runNode(SCRIPT, { args, cwd: project, env: isolatedEnv(home, extra) })
}

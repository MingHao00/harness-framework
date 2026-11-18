'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { runNode } = require('./spawn-hook')
const { parseInput, filePathFrom, commandFrom, emit } = require('./lib/cursor-input')

const INPUT_LIB = path.join(__dirname, 'lib', 'cursor-input.js')

test('parseInput keeps objects and treats everything else as empty', () => {
  assert.deepEqual(parseInput(''), {})
  assert.deepEqual(parseInput('   '), {})
  assert.deepEqual(parseInput('not-json'), {})
  assert.deepEqual(parseInput('null'), {})
  assert.deepEqual(parseInput('1'), {})
  assert.deepEqual(parseInput('true'), {})
  assert.deepEqual(parseInput('"text"'), {})
  assert.deepEqual(parseInput('[]'), [])
  assert.deepEqual(parseInput('{"file_path":"a.js"}'), { file_path: 'a.js' })
})

test('filePathFrom uses the first non-empty string', () => {
  assert.equal(filePathFrom({}), '')
  assert.equal(filePathFrom({ file_path: '', path: 'from-path', filePath: 'later' }), 'from-path')
  assert.equal(filePathFrom({ file_path: 1, path: 'from-path' }), 'from-path')
  assert.equal(filePathFrom({ file_path: 'top.js', tool_input: { file_path: 'inner.js' } }), 'top.js')
  assert.equal(filePathFrom({ tool_input: null, input: { target_file: 'nested.ts' } }), 'nested.ts')
  assert.equal(filePathFrom({ tool_input: { file: 'tool.js' } }), 'tool.js')
})

test('commandFrom skips non-strings and keeps an empty string', () => {
  assert.equal(commandFrom({}), '')
  assert.equal(commandFrom({ command: '', tool_input: { command: 'git push' } }), '')
  assert.equal(commandFrom({ command: 1, tool_input: { command: 'git push' } }), 'git push')
  assert.equal(commandFrom({ input: { command: 'npm test' } }), 'npm test')
})

test('emit writes one JSON payload to stdout', () => {
  const chunks = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }
  try {
    emit({ permission: 'allow' })
  } finally {
    process.stdout.write = original
  }
  assert.deepEqual(chunks, ['{"permission":"allow"}'])
})

test('readStdin resolves the piped text and an empty pipe', () => {
  const source = `
    const { readStdin } = require(${JSON.stringify(INPUT_LIB)})
    readStdin().then((data) => process.stdout.write(data))
  `
  const text = runNode('-e', { args: [source], input: 'hello' })
  assert.equal(text.status, 0, text.stderr)
  assert.equal(text.stdout, 'hello')
  const empty = runNode('-e', { args: [source], input: '' })
  assert.equal(empty.status, 0, empty.stderr)
  assert.equal(empty.stdout, '')
})

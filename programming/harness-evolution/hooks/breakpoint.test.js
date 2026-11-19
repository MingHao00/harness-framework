'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { runBreakpoint } = require('./breakpoint-flow')

const SESSION_ID = 'a1b2c3d4-1111-4222-8333-abcdefabcdef'
const SHORT_ID = 'a1b2c3d4'
const SECRET = 'sk-realsecretvalue'
const SCRIPT = path.join(__dirname, 'breakpoint.js')

test('skips when the conversation id is missing', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const result = await runBreakpoint({
      hook_event_name: 'preCompact',
      workspace_roots: [repo],
    }, options(repo, notes))
    assert.equal(result.status, 'skipped')
    assert.equal(notes.calls, 0)
    await assert.rejects(fs.access(nowPath(repo)))
  })
})

test('writes the breakpoint and leaves the daily log alone', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat({ stopped: `留下 ${SECRET}` })
    const transcriptPath = await putTranscript(repo, `密钥 ${SECRET} 不要写入断点`)
    const result = await runBreakpoint(
      event(repo, 'preCompact', transcriptPath),
      options(repo, notes),
    )
    const body = await fs.readFile(nowPath(repo), 'utf8')
    assert.equal(result.status, 'written')
    assert.equal(result.additional_context, undefined)
    assert.match(body, /## 现在停在哪\n留下 \[REDACTED\]/)
    assert.match(body, /## 对话里的验证\n转录里 1 个测试失败/)
    assert.match(body, /## 已知问题\n空结果返回 500/)
    assert.match(body, /## 下一步\n先修边界/)
    assert.match(body, /## 检查\n检查尚未配置/)
    assert.equal(body.includes(SECRET), false)
    assert.equal(notes.prompts[0].includes(SECRET), false)
    await assert.rejects(fs.access(path.join(repo, 'Decision')))
    await assert.rejects(fs.access(path.join(repo, 'log', 'index.md')))
  })
})

test('keeps the previous file when the model fails', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, '先写一份')
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), options(repo, countingChat()))
    const kept = await fs.readFile(nowPath(repo), 'utf8')
    await fs.writeFile(stampPath(repo), 'stale', 'utf8')
    const failed = countingChat({ fail: true })
    const result = await runBreakpoint(
      event(repo, 'sessionEnd', transcriptPath),
      options(repo, failed),
    )
    assert.equal(result.status, 'kept')
    assert.equal(await fs.readFile(nowPath(repo), 'utf8'), kept)
    assert.equal(failed.calls, 1)
  })
})

test('a failed compact still marks the previous breakpoint for one inject', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, '先写一份')
    const opts = options(repo, countingChat())
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    await fs.rm(injectPath(repo), { force: true })
    await fs.writeFile(stampPath(repo), 'stale', 'utf8')
    const failed = countingChat({ fail: true })
    const result = await runBreakpoint(
      event(repo, 'preCompact', transcriptPath),
      options(repo, failed),
    )
    const injected = await runBreakpoint(
      event(repo, 'postToolUse', transcriptPath),
      options(repo, failed),
    )
    assert.equal(result.status, 'kept')
    assert.match(injected.additional_context, /停在分页/)
  })
})

test('refresh updates the last check heading', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat({ stopped: '正文里有\n## 检查\n假结果' })
    const transcriptPath = await putTranscript(repo, '检查栏在末尾')
    await runBreakpoint(
      event(repo, 'preCompact', transcriptPath),
      options(repo, notes),
    )
    await fs.writeFile(path.join(repo, 'Makefile'), 'check:\n\tfalse\n', 'utf8')
    const started = await runBreakpoint(
      event(repo, 'sessionStart', transcriptPath),
      options(repo, notes, {
        runCheck: async () => ({ status: '检查失败\nexit 2' }),
      }),
    )
    const body = started.additional_context
    assert.match(body, /## 现在停在哪\n正文里有\n## 检查\n假结果/)
    assert.match(body, /## 检查\n检查失败\nexit 2\s*$/)
  })
})

test('keeps the previous file when the model reply is not json', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, '先写一份')
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), options(repo, countingChat()))
    const kept = await fs.readFile(nowPath(repo), 'utf8')
    await fs.writeFile(stampPath(repo), 'stale', 'utf8')
    const notes = countingChat({ raw: '不是 json' })
    const result = await runBreakpoint(
      event(repo, 'sessionEnd', transcriptPath),
      options(repo, notes),
    )
    assert.equal(result.status, 'kept')
    assert.equal(notes.calls, 1)
    assert.equal(await fs.readFile(nowPath(repo), 'utf8'), kept)
  })
})

test('session end does not call the model again for the same transcript', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const transcriptPath = await putTranscript(repo, '同一份转录')
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), options(repo, notes))
    const result = await runBreakpoint(
      event(repo, 'sessionEnd', transcriptPath),
      options(repo, notes),
    )
    assert.equal(result.status, 'fresh')
    assert.equal(notes.calls, 1)
  })
})

test('session end writes again after the transcript changes', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const transcriptPath = await putTranscript(repo, '第一段')
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), options(repo, notes))
    await fs.appendFile(transcriptPath, `\n${line('第二段')}`, 'utf8')
    const result = await runBreakpoint(
      event(repo, 'sessionEnd', transcriptPath),
      options(repo, notes),
    )
    assert.equal(result.status, 'written')
    assert.equal(notes.calls, 2)
  })
})

test('a repeated compact injects again without a second model call', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const transcriptPath = await putTranscript(repo, '同一份转录')
    const opts = options(repo, notes)
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    await runBreakpoint(event(repo, 'postToolUse', transcriptPath), opts)
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    const injected = await runBreakpoint(event(repo, 'postToolUse', transcriptPath), opts)
    assert.equal(notes.calls, 1)
    assert.match(injected.additional_context, /## 下一步/)
  })
})

test('session start injects once and the next tool does not', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const transcriptPath = await putTranscript(repo, '开场要读')
    const opts = options(repo, notes)
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    const started = await runBreakpoint(event(repo, 'sessionStart', transcriptPath), opts)
    const tool = await runBreakpoint(event(repo, 'postToolUse', transcriptPath), opts)
    assert.match(started.additional_context, /## 现在停在哪/)
    assert.equal(tool.status, 'idle')
    await assert.rejects(fs.access(injectPath(repo)))
    assert.equal(notes.calls, 1)
  })
})

test('session start with no file injects nothing', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const result = await runBreakpoint(
      event(repo, 'sessionStart'),
      options(repo, notes, { runCheck: explodingCheck }),
    )
    assert.equal(result.status, 'empty')
    assert.equal(result.additional_context, undefined)
    assert.equal(notes.calls, 0)
    await assert.rejects(fs.access(nowPath(repo)))
  })
})

test('postToolUse without a marker does not read the breakpoint', async () => {
  await withRepo(async (repo) => {
    await fs.mkdir(path.dirname(nowPath(repo)), { recursive: true })
    await fs.writeFile(nowPath(repo), '不应被读到\n', 'utf8')
    const result = await runBreakpoint(
      event(repo, 'postToolUse'),
      options(repo, countingChat()),
    )
    assert.equal(result.status, 'idle')
    assert.equal(result.additional_context, undefined)
  })
})

test('only one of two racing tool hooks injects', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, '只注入一次')
    const opts = options(repo, countingChat())
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    const [first, second] = await Promise.all([
      runBreakpoint(event(repo, 'postToolUse', transcriptPath), opts),
      runBreakpoint(event(repo, 'postToolUse', transcriptPath), opts),
    ])
    const injected = [first, second].filter((item) => item.additional_context)
    assert.equal(injected.length, 1)
  })
})

test('does not run make check until a check target exists', async () => {
  await withRepo(async (repo) => {
    const transcriptPath = await putTranscript(repo, '还没有检查')
    const result = await runBreakpoint(
      event(repo, 'preCompact', transcriptPath),
      options(repo, countingChat(), { runCheck: explodingCheck }),
    )
    const body = await fs.readFile(nowPath(repo), 'utf8')
    assert.equal(result.status, 'written')
    assert.match(body, /检查尚未配置/)
  })
})

test('writes a failed make check into the breakpoint', async () => {
  await withRepo(async (repo) => {
    await fs.writeFile(path.join(repo, 'Makefile'), 'check:\n\tfalse\n', 'utf8')
    const transcriptPath = await putTranscript(repo, '检查会失败')
    const result = await runBreakpoint(
      event(repo, 'preCompact', transcriptPath),
      options(repo, countingChat(), {
        runCheck: async () => ({ status: '检查失败\nexit 2' }),
      }),
    )
    const body = await fs.readFile(nowPath(repo), 'utf8')
    assert.equal(result.status, 'written')
    assert.match(body, /## 检查\n检查失败\nexit 2/)
  })
})

test('session start refreshes the check line without calling the model', async () => {
  await withRepo(async (repo) => {
    const notes = countingChat()
    const transcriptPath = await putTranscript(repo, '开场更新检查')
    const opts = options(repo, notes)
    await runBreakpoint(event(repo, 'preCompact', transcriptPath), opts)
    await fs.writeFile(path.join(repo, 'Makefile'), 'check:\n\tfalse\n', 'utf8')
    const started = await runBreakpoint(
      event(repo, 'sessionStart', transcriptPath),
      options(repo, notes, {
        runCheck: async () => ({ status: '检查失败\nexit 2' }),
      }),
    )
    assert.equal(notes.calls, 1)
    assert.match(started.additional_context, /## 检查\n检查失败\nexit 2/)
    assert.match(started.additional_context, /## 下一步\n先修边界/)
  })
})

test('cli exits 0 when the conversation id is missing', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ hook_event_name: 'preCompact' }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

function options(repo, notes, extra) {
  return {
    repoRoot: repo,
    completeChat: notes.completeChat,
    ...extra,
  }
}

function event(repo, name, transcriptPath) {
  return {
    hook_event_name: name,
    conversation_id: SESSION_ID,
    workspace_roots: [repo],
    transcript_path: transcriptPath || '',
  }
}

function countingChat(extra) {
  const notes = { calls: 0, prompts: [] }
  const settings = extra || {}
  notes.completeChat = async ({ prompt }) => {
    notes.calls += 1
    notes.prompts.push(prompt)
    if (settings.fail) throw new Error('down')
    if (settings.raw) return settings.raw
    return JSON.stringify({
      stopped: settings.stopped || '停在分页',
      dialogueVerification: '转录里 1 个测试失败',
      knownIssues: '空结果返回 500',
      nextSteps: '先修边界',
    })
  }
  return notes
}

function explodingCheck() {
  throw new Error('should not run')
}

function nowPath(repo) {
  return path.join(repo, 'log', 'now', `${SHORT_ID}.md`)
}

function stampPath(repo) {
  return path.join(repo, 'log', 'now', `${SHORT_ID}.stamp`)
}

function injectPath(repo) {
  return path.join(repo, 'log', 'now', `${SHORT_ID}.inject`)
}

function line(text) {
  return JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text }] },
  })
}

async function putTranscript(repo, text) {
  const filePath = path.join(repo, 'transcript.jsonl')
  await fs.writeFile(filePath, `${line(text)}\n`, 'utf8')
  return filePath
}

async function withRepo(run) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'breakpoint-'))
  try {
    await run(repo)
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
}

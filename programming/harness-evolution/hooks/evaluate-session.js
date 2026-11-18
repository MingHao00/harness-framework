#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getLearnedSkillsDir,
  getContinuousLearningPendingPath,
  ensureDir,
  readFile,
  writeFile,
  countInFile,
  log,
} = require('./lib/utils');
const { readStdin, parseInput } = require('./lib/cursor-input');
const { loadEnvFile } = require('./env-file');
const { completeChat } = require('./model-client');
const { readPreparedTranscript } = require('./transcript');
const { SessionRecordError } = require('./errors');
const { EVOLVE_SYSTEM_PROMPT, buildEvolvePrompt } = require('./evolve-prompt');
const { parseDraftItems, pendingPayload, draftPayload } = require('./evolve-draft');

const DEFAULT_MIN_MESSAGES = 10;
const USER_ROLE_PATTERN = /"role"\s*:\s*"user"/g;
const USER_TYPE_PATTERN = /"type"\s*:\s*"user"/g;

const SKIPPED_STATUS = 'skipped';
const EMPTY_STATUS = 'empty';
const MODEL_FAILURE_FALLBACK = '模型草稿失败';

/**
 * 会话结束时检查长度。够长就向模型要草稿，失败则只留转录路径。
 *
 * @returns {Promise<void>}
 */
async function main() {
  const config = loadConfig(path.join(__dirname, '..', 'skills', 'continuous-learning', 'config.json'));
  const learnedSkillsPath = resolveLearnedPath(config.learnedSkillsPath);
  ensureDir(learnedSkillsPath);
  const transcriptPath = await resolveTranscriptPath();
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);
  await evaluateTranscript({
    transcriptPath,
    minSessionLength: config.minSessionLength,
    learnedSkillsPath,
    pendingPath: getContinuousLearningPendingPath(),
    repoRoot: process.cwd(),
    env: process.env,
  });
  process.exit(0);
}

/**
 * 短会话不写文件。有合格条目才写 draft。模型失败时保留转录路径。
 *
 * @param {object} options 转录、阈值、待确认路径和可替换的模型
 * @returns {Promise<{ status: string }>} skipped、empty、draft 或 pending
 */
async function evaluateTranscript(options) {
  const messageCount = countUserMessages(options.transcriptPath);
  if (messageCount < options.minSessionLength) {
    log(`[ContinuousLearning] Session too short (${messageCount} messages), skipping`);
    return { status: SKIPPED_STATUS };
  }
  const fields = sessionFields(options, messageCount);
  try {
    return await writeDraft(options, fields);
  } catch (error) {
    writeFile(options.pendingPath, serialize(pendingPayload(fields)));
    log(`[ContinuousLearning] ${failureReason(error)}，只保留转录路径`);
    return { status: 'pending' };
  }
}

async function writeDraft(options, fields) {
  const raw = await requestDraft(options);
  const items = parseDraftItems(raw, options.transcriptPath);
  if (!items.length) {
    removeFile(options.pendingPath);
    log('[ContinuousLearning] 没有可记的事实');
    return { status: EMPTY_STATUS };
  }
  writeFile(options.pendingPath, serialize(draftPayload(fields, items)));
  log('[ContinuousLearning] 已写入自进化草稿');
  return { status: 'draft' };
}

async function requestDraft(options) {
  const transcript = await readPreparedTranscript(options.transcriptPath);
  const env = { ...options.env };
  loadEnvFile(options.repoRoot, env);
  return completeChat({
    env,
    system: EVOLVE_SYSTEM_PROMPT,
    prompt: buildEvolvePrompt(transcript),
    fetchImpl: options.fetchImpl,
  });
}

function sessionFields(options, messageCount) {
  return {
    transcriptPath: options.transcriptPath,
    messageCount,
    learnedSkillsPath: options.learnedSkillsPath,
  };
}

function failureReason(error) {
  if (error instanceof SessionRecordError) return error.reason;
  return MODEL_FAILURE_FALLBACK;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

/**
 * @param {string} configFile
 * @returns {{ minSessionLength: number, learnedSkillsPath: string }}
 */
function loadConfig(configFile) {
  const defaults = {
    minSessionLength: DEFAULT_MIN_MESSAGES,
    learnedSkillsPath: getLearnedSkillsDir(),
  };
  const content = readFile(configFile);
  if (!content) return defaults;
  try {
    const config = JSON.parse(content);
    return {
      minSessionLength: config.min_session_length || DEFAULT_MIN_MESSAGES,
      learnedSkillsPath: config.learned_skills_path || defaults.learnedSkillsPath,
    };
  } catch {
    return defaults;
  }
}

/**
 * @param {string} configuredPath
 * @returns {string}
 */
function resolveLearnedPath(configuredPath) {
  return configuredPath.replace(/^~/, require('os').homedir());
}

/**
 * Cursor 把 transcript_path 放在 stdin。旧变量仍可作为后备。
 *
 * @returns {Promise<string>}
 */
async function resolveTranscriptPath() {
  const input = process.stdin.isTTY ? {} : parseInput(await readStdin());
  const fromInput = firstText(input.transcript_path, input.transcriptPath);
  if (fromInput) return fromInput;
  return firstText(process.env.CURSOR_TRANSCRIPT_PATH, process.env.CLAUDE_TRANSCRIPT_PATH);
}

/**
 * @param {unknown} cursorValue
 * @param {unknown} claudeValue
 * @returns {string}
 */
function firstText(cursorValue, claudeValue) {
  if (typeof cursorValue === 'string' && cursorValue.trim()) return cursorValue.trim();
  if (typeof claudeValue === 'string' && claudeValue.trim()) return claudeValue.trim();
  return '';
}

/**
 * Cursor 转录用 role，Claude Code 转录用 type。同一行不会两种都算。
 *
 * @param {string} transcriptPath
 * @returns {number}
 */
function countUserMessages(transcriptPath) {
  const roleCount = countInFile(transcriptPath, USER_ROLE_PATTERN);
  const typeCount = countInFile(transcriptPath, USER_TYPE_PATTERN);
  return Math.max(roleCount, typeCount);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[ContinuousLearning] Error:', error.message);
    process.exit(0);
  });
}

module.exports = {
  loadConfig,
  resolveLearnedPath,
  firstText,
  countUserMessages,
  evaluateTranscript,
};

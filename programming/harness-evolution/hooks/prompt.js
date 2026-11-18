'use strict'

const { EMPTY_FIELD } = require('./constants')

const SYSTEM_PROMPT = [
  '你是 Harness 的会话记录员。只返回一个 JSON 对象，不要 Markdown，不要解释。',
  '字段必须齐全：hasWork, did, paths, unfinished, hasDecision, failed, next, commands, decisions, supersedes。',
  'decisions 每项只有 chose, rejected, why, reopenWhen。paths 是字符串数组。没有的文字字段用空字符串。',
  '判定规则：',
  '1. 没有实际工作（没改文件、没查资料、没跑命令、没讨论出结论）则 hasWork 为 false，其余文字字段留空，decisions 为 []。',
  '2. 决策只包括会约束以后实现的选择：定了方案、否掉方案、改了设计文档里的规则、换了依赖或数据格式。来源可以是 Plan 模式、Grilling 讨论、或写代码时的关键取舍。改名、排版、笔误、按已有文档照做不算。拿不准就不要决策，hasDecision 为 false，decisions 为 []。',
  '3. commands 只有在结果会影响下一步时才填，否则为空字符串。',
  '4. supersedes 是被本次替代的旧决策文件名（仅文件名，不要目录）。没有则空字符串。只能从下面「当前」列表里已有的文件名里选，不要编造。',
  '5. 不抄对话原文，不写密钥、令牌或 Bearer。',
].join('\n')

/**
 * 组装用户消息。只附决策索引的「当前」行，不附旧决策正文。
 *
 * @param {string} transcript 已脱敏的转录
 * @param {string[]} currentLines 「当前」段的现有行
 * @returns {string} 发给模型的用户消息
 */
function buildUserPrompt(transcript, currentLines) {
  const current = currentLines.length ? currentLines.join('\n') : '（当前没有决策）'
  return [
    '下面是 Decision/index.md「当前」段的现有行：',
    current,
    '',
    '下面是本次对话转录（只含文本，已脱敏，过长时只保留末尾）：',
    transcript || EMPTY_FIELD,
  ].join('\n')
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt }

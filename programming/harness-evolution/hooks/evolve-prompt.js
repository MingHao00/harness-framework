'use strict'

const EMPTY_TRANSCRIPT = '无'

const EVOLVE_SYSTEM_PROMPT = [
  '你是 Harness 自进化草稿员。只返回一个 JSON 对象，不要 Markdown，不要解释。',
  '对象只有 items 数组。没有可记的事实时 items 为空数组。',
  '每条有 file、category、what、change、check。都是非空字符串。',
  'category 只能是 user_corrections、repeated_artifact_errors、default_approaches、framework_pitfalls、framework_scaffolds。',
  'file 是要改的仓库相对路径。前三类指向已有的技能、钩子、规则或子代理。',
  'framework_pitfalls 和 framework_scaffolds 的 file 指向 .cursor/skills/learned/ 下该框架的 SKILL.md。',
  'what 写修改了什么。change 写行为上变成什么。check 写成功标准；钩子则写要跑的 node --test 路径。',
  '只根据转录里已经发生的事。框架名必须在转录里出现过。不写密钥、令牌、密码。不提议转录里没出现的改进。',
].join('\n')

/**
 * 把已脱敏的转录交给草稿员。来源路径由钩子填写，不让模型编。
 *
 * @param {string} transcript 已脱敏文本
 * @returns {string} 用户消息
 */
function buildEvolvePrompt(transcript) {
  const body = transcript && transcript.trim() ? transcript.trim() : EMPTY_TRANSCRIPT
  return `下面是本次对话转录（只含文本，已脱敏，过长时只保留末尾）：\n${body}`
}

module.exports = { EVOLVE_SYSTEM_PROMPT, buildEvolvePrompt }

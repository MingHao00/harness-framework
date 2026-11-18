'use strict'

const REQUEST_TIMEOUT_MS = 60000
const MAX_TRANSCRIPT_CHARS = 24000
const SHORT_ID_LENGTH = 8
const INDEX_SUMMARY_MAX_CHARS = 80
const MIN_SECRET_BODY_LENGTH = 4
const MODEL_TEMPERATURE = 0
const MODEL_MAX_OUTPUT_TOKENS = 2048
const THINKING_DISABLED = 'disabled'
const HTTP_OK_MIN = 200
const HTTP_OK_MAX = 299
const NOTIFY_TIMEOUT_MS = 15000
const NOTIFY_BALLOON_MS = 8000
const NOTIFY_HOLD_MS = 4000
const QUOTE_WRAP_MIN = 2
const DISPLAY_INDEX_OFFSET = 1
const BEIJING_TIME_ZONE = 'Asia/Shanghai'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const REDACTED_MARK = '[REDACTED]'
const EMPTY_FIELD = '无'
const MISSING_SHORT_ID = 'missing1'
const PROJECT_TRANSCRIPT_SLUG = 'harness'
const LOG_DIR_NAME = 'log'
const DECISION_DIR_NAME = 'Decision'
const ERROR_DIR_NAME = 'errors'
const INDEX_FILE_NAME = 'index.md'
const ENV_KEY_NAME = 'SESSION_LOG_API_KEY'
const ENV_BASE_URL_NAME = 'SESSION_LOG_BASE_URL'
const ENV_MODEL_NAME = 'SESSION_LOG_MODEL'
const TRANSCRIPT_ENV_NAME = 'CURSOR_TRANSCRIPT_PATH'
const FAIL_NO_KEY = '未设置 SESSION_LOG_API_KEY'
const FAIL_NO_TRANSCRIPT = '找不到转录'
const FAIL_BAD_MODEL = '模型返回无法解析'
const FAIL_NETWORK = '网络请求失败'
const FAIL_TIMEOUT = '请求超时'
const FAIL_BAD_INPUT = '无法解析 Hook 输入'
const CURRENT_HEADING = '## 当前'
const SUPERSEDED_HEADING = '## 已替代'
const DECISION_INDEX_TITLE = '# 决策索引'
const LOG_INDEX_TITLE = '# 工作日志索引'
const NOTIFY_TITLE = 'Harness 会话记录失败'
const COMPLETIONS_PATH = '/chat/completions'
const BEARER_SCHEME = 'Bearer'
const CONTENT_TYPE_JSON = 'application/json'
const POWERSHELL_EXE = 'powershell.exe'
const EXPORT_PREFIX = 'export '
const HOUR_MIDNIGHT_BUG = '24'
const HOUR_MIDNIGHT = '00'
const ENV_FILE_NAME = '.env'
const PENDING_DIR_NAME = '.cursor'
const PENDING_FILE_NAME = 'session-record-pending.json'
const FLUSH_BUDGET_MS = 150000
const FLUSH_PROMPT = '补写工作日志'
const WINDOWS_DRIVE_PREFIX = /^\/+([A-Za-z]):[\\/]?(.*)$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_ID_PATTERN = /[^a-z0-9]/g
const DECISION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]{1,8}\.md$/
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i
const SESSION_MARKER_PATTERN = /<!--\s*session:[^>]*-->/g
const SENTENCE_SPLIT_PATTERN = /[。！？.!?]/
const SECRET_KEY_NAME = '(?:api[_-]?key|token|secret|password)'
const BARE_DOUBLE_GROUP = 2
const BARE_SINGLE_GROUP = 3
const KEYED_DOUBLE_GROUP = 4
const KEYED_SINGLE_GROUP = 5

// 引号里的值要整段替换；转义引号仍属这个字符串，不能把后面的字段一起吃掉。
function quotedSecretValue(quote, group) {
  const plain = quote === '"' ? '[^"\\\\\\r\\n]' : "[^'\\\\\\r\\n]"
  const body = `(?:\\\\[^\\r\\n]|${plain}){${MIN_SECRET_BODY_LENGTH},}`
  return `(${quote})${body}\\${group}`
}

// 成对引号已经被吃掉，要补回去；松散值的结束引号还在原文里。
function maskBareSecret(match, prefix, doubleQuote, singleQuote, looseQuote) {
  const quote = doubleQuote || singleQuote
  if (quote) return `${prefix}${quote}${REDACTED_MARK}${quote}`
  return `${prefix}${looseQuote || ''}${REDACTED_MARK}`
}

function maskKeyedSecret(match, keyQuote, keyName, gap, doubleQuote, singleQuote) {
  const quote = doubleQuote || singleQuote || ''
  return `${keyQuote}${keyName}${keyQuote}${gap}${quote}${REDACTED_MARK}${quote}`
}

const SECRET_PATTERNS = [
  {
    pattern: new RegExp(`sk-[A-Za-z0-9_-]{${MIN_SECRET_BODY_LENGTH},}`, 'g'),
    replacement: REDACTED_MARK,
  },
  {
    pattern: new RegExp(
      `Bearer\\s+[A-Za-z0-9._~+/=-]{${MIN_SECRET_BODY_LENGTH},}`,
      'gi',
    ),
    replacement: `Bearer ${REDACTED_MARK}`,
  },
  {
    pattern: new RegExp(
      `((?:${SECRET_KEY_NAME})\\s*[=:]\\s*)(?:`
      + `${quotedSecretValue('"', BARE_DOUBLE_GROUP)}|`
      + `${quotedSecretValue("'", BARE_SINGLE_GROUP)}|`
      + `(['"]?)[^\\s'",}]{${MIN_SECRET_BODY_LENGTH},})`,
      'gi',
    ),
    replacement: maskBareSecret,
  },
  {
    // 键名自己的引号夹在名字和冒号之间，上面那条对不齐。
    pattern: new RegExp(
      `(["'])(${SECRET_KEY_NAME})\\1(\\s*[=:]\\s*)(?:`
      + `${quotedSecretValue('"', KEYED_DOUBLE_GROUP)}|`
      + `${quotedSecretValue("'", KEYED_SINGLE_GROUP)})`,
      'gi',
    ),
    replacement: maskKeyedSecret,
  },
]

const ALLOWED_ENV_KEYS = [ENV_KEY_NAME, ENV_BASE_URL_NAME, ENV_MODEL_NAME]

module.exports = {
  REQUEST_TIMEOUT_MS,
  MAX_TRANSCRIPT_CHARS,
  SHORT_ID_LENGTH,
  INDEX_SUMMARY_MAX_CHARS,
  MODEL_TEMPERATURE,
  MODEL_MAX_OUTPUT_TOKENS,
  THINKING_DISABLED,
  HTTP_OK_MIN,
  HTTP_OK_MAX,
  NOTIFY_TIMEOUT_MS,
  NOTIFY_BALLOON_MS,
  NOTIFY_HOLD_MS,
  QUOTE_WRAP_MIN,
  DISPLAY_INDEX_OFFSET,
  BEIJING_TIME_ZONE,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  REDACTED_MARK,
  EMPTY_FIELD,
  MISSING_SHORT_ID,
  PROJECT_TRANSCRIPT_SLUG,
  LOG_DIR_NAME,
  DECISION_DIR_NAME,
  ERROR_DIR_NAME,
  INDEX_FILE_NAME,
  ENV_KEY_NAME,
  ENV_BASE_URL_NAME,
  ENV_MODEL_NAME,
  TRANSCRIPT_ENV_NAME,
  FAIL_NO_KEY,
  FAIL_NO_TRANSCRIPT,
  FAIL_BAD_MODEL,
  FAIL_NETWORK,
  FAIL_TIMEOUT,
  FAIL_BAD_INPUT,
  CURRENT_HEADING,
  SUPERSEDED_HEADING,
  DECISION_INDEX_TITLE,
  LOG_INDEX_TITLE,
  NOTIFY_TITLE,
  COMPLETIONS_PATH,
  BEARER_SCHEME,
  CONTENT_TYPE_JSON,
  POWERSHELL_EXE,
  EXPORT_PREFIX,
  HOUR_MIDNIGHT_BUG,
  HOUR_MIDNIGHT,
  ENV_FILE_NAME,
  PENDING_DIR_NAME,
  PENDING_FILE_NAME,
  FLUSH_BUDGET_MS,
  FLUSH_PROMPT,
  WINDOWS_DRIVE_PREFIX,
  UUID_PATTERN,
  SAFE_ID_PATTERN,
  DECISION_FILE_PATTERN,
  CONVERSATION_ID_PATTERN,
  FENCE_PATTERN,
  SESSION_MARKER_PATTERN,
  SENTENCE_SPLIT_PATTERN,
  SECRET_PATTERNS,
  ALLOWED_ENV_KEYS,
}

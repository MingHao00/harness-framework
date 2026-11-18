'use strict'

const { SYSTEM_PROMPT } = require('./prompt')
const { SessionRecordError } = require('./errors')
const {
  REQUEST_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_TEMPERATURE,
  MODEL_MAX_OUTPUT_TOKENS,
  THINKING_DISABLED,
  HTTP_OK_MIN,
  HTTP_OK_MAX,
  ENV_KEY_NAME,
  ENV_BASE_URL_NAME,
  ENV_MODEL_NAME,
  COMPLETIONS_PATH,
  BEARER_SCHEME,
  CONTENT_TYPE_JSON,
  FAIL_NO_KEY,
  FAIL_NETWORK,
  FAIL_TIMEOUT,
  FAIL_BAD_MODEL,
} = require('./constants')

/**
 * 调用 OpenAI 兼容的 chat completions。密钥只从环境变量读取。
 *
 * @param {{ env: NodeJS.ProcessEnv, prompt: string, fetchImpl?: typeof fetch }} request
 * @returns {Promise<string>} 模型消息正文
 * @throws {SessionRecordError} 缺少密钥、超时、网络失败或返回不可用
 */
async function completeChat(request) {
  const apiKey = readApiKey(request.env)
  const response = await callModel(
    request.fetchImpl || globalThis.fetch,
    completionsUrl(request.env),
    apiKey,
    request.env[ENV_MODEL_NAME] || DEFAULT_MODEL,
    request.prompt,
    request.system,
  )
  return readContent(response)
}

function readApiKey(env) {
  const apiKey = env && typeof env[ENV_KEY_NAME] === 'string' ? env[ENV_KEY_NAME].trim() : ''
  if (!apiKey) throw new SessionRecordError(FAIL_NO_KEY)
  return apiKey
}

function completionsUrl(env) {
  const base = String(env[ENV_BASE_URL_NAME] || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return `${base}${COMPLETIONS_PATH}`
}

async function callModel(fetchImpl, url, apiKey, model, prompt, system) {
  if (typeof fetchImpl !== 'function') throw new SessionRecordError(FAIL_NETWORK)
  try {
    const response = await fetchImpl(url, buildRequest(apiKey, model, prompt, system))
    if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
      throw new SessionRecordError(`模型接口状态码 ${response.status}`)
    }
    return response
  } catch (error) {
    throw mapCallError(error)
  }
}

function buildRequest(apiKey, model, prompt, system) {
  return {
    method: 'POST',
    headers: {
      Authorization: `${BEARER_SCHEME} ${apiKey}`,
      'Content-Type': CONTENT_TYPE_JSON,
    },
    body: JSON.stringify({
      model,
      temperature: MODEL_TEMPERATURE,
      max_tokens: MODEL_MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
      // 思考默认开着，会把额度用完，最终 JSON 落不到 content。
      thinking: { type: THINKING_DISABLED },
      messages: [
        { role: 'system', content: system || SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }
}

function mapCallError(error) {
  if (error instanceof SessionRecordError) return error
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new SessionRecordError(FAIL_TIMEOUT)
  }
  return new SessionRecordError(FAIL_NETWORK)
}

async function readContent(response) {
  try {
    const body = await response.json()
    const choice = body && body.choices && body.choices[0]
    const text = choice && choice.message && choice.message.content
    if (typeof text !== 'string' || !text.trim()) throw new SessionRecordError(FAIL_BAD_MODEL)
    return text
  } catch (error) {
    if (error instanceof SessionRecordError) throw error
    throw new SessionRecordError(FAIL_BAD_MODEL)
  }
}

module.exports = { completeChat }

'use strict';

const fs = require('fs');

/**
 * Read the JSON payload Cursor passes to a hook on stdin.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseInput(raw) {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function filePathFrom(input) {
  const toolInput = asRecord(input.tool_input);
  const nested = asRecord(input.input);
  const candidates = [
    input.file_path,
    input.path,
    input.filePath,
    toolInput.file_path,
    toolInput.path,
    toolInput.filePath,
    toolInput.file,
    toolInput.target_file,
    nested.file_path,
    nested.path,
    nested.target_file,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return '';
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function commandFrom(input) {
  const toolInput = asRecord(input.tool_input);
  const nested = asRecord(input.input);
  const candidates = [input.command, toolInput.command, nested.command];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return '';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

/**
 * @param {Record<string, unknown>} payload
 */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

module.exports = {
  readStdin,
  parseInput,
  filePathFrom,
  commandFrom,
  emit,
};

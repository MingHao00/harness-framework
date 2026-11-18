'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptName = process.argv[2];
if (!scriptName || scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
  process.exit(0);
}

const scriptPath = path.join(__dirname, scriptName);
// Cursor 把钩子 JSON 放在 stdin。不传下去时，子脚本看不到转录路径。
const input = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
const result = spawnSync(process.execPath, [scriptPath], {
  encoding: 'utf8',
  cwd: __dirname,
  env: process.env,
  input,
});
const note = `${result.stderr || ''}${result.stdout || ''}`.trim();
if (note) {
  process.stdout.write(JSON.stringify({ additional_context: note }));
}
process.exit(0);

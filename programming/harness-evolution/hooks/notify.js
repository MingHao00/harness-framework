'use strict'

const { spawn } = require('child_process')
const {
  NOTIFY_TIMEOUT_MS,
  NOTIFY_BALLOON_MS,
  NOTIFY_HOLD_MS,
  POWERSHELL_EXE,
} = require('./constants')

// 未注册 AUMID 时 WinRT Toast 会失败，气球通知是退路。
// 进程马上退出时，还没画出来的通知会被一起收掉，所以要停一会儿。
const NOTIFY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$title = $env:SESSION_NOTIFY_TITLE
$body = $env:SESSION_NOTIFY_BODY
$balloonMs = [int]$env:SESSION_NOTIFY_BALLOON_MS
$holdMs = [int]$env:SESSION_NOTIFY_HOLD_MS
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>')
  $nodes = $xml.GetElementsByTagName('text')
  $nodes.Item(0).InnerText = $title
  $nodes.Item(1).InnerText = $body
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PowerShell')
  $notifier.Show($toast)
  Start-Sleep -Milliseconds $holdMs
  Write-Output 'toast-shown'
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.Visible = $true
  $icon.ShowBalloonTip($balloonMs, $title, $body, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Milliseconds $holdMs
  $icon.Dispose()
  Write-Output 'balloon-shown'
}
`

/**
 * 用 PowerShell 发一条系统通知。失败时返回原因，不抛出。
 *
 * @param {string} title 通知标题
 * @param {string} message 通知正文，不能含密钥
 * @returns {Promise<{ ok: boolean, channel: string, detail: string }>}
 */
function sendWindowsNotification(title, message) {
  return new Promise((resolve) => {
    const child = spawnNotify(title, message)
    const output = { stdout: [], stderr: [] }
    let settled = false
    const timer = setTimeout(() => finish(false, 'timeout', '通知超时'), NOTIFY_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => output.stdout.push(chunk))
    child.stderr.on('data', (chunk) => output.stderr.push(chunk))
    child.on('error', (error) => finish(false, 'error', error.message))
    child.on('close', (code) => finishClose(code, output))

    function finishClose(code, buffers) {
      const out = Buffer.concat(buffers.stdout).toString('utf8').trim()
      const err = Buffer.concat(buffers.stderr).toString('utf8').trim()
      if (code === 0 && out) finish(true, out.split(/\r?\n/).pop(), '')
      else finish(false, 'error', err || out || `powershell ${code}`)
    }

    function finish(ok, channel, detail) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve({ ok, channel, detail })
    }
  })
}

function spawnNotify(title, message) {
  return spawn(POWERSHELL_EXE, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    NOTIFY_SCRIPT,
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      SESSION_NOTIFY_TITLE: title,
      SESSION_NOTIFY_BODY: message,
      SESSION_NOTIFY_BALLOON_MS: String(NOTIFY_BALLOON_MS),
      SESSION_NOTIFY_HOLD_MS: String(NOTIFY_HOLD_MS),
    },
  })
}

module.exports = { sendWindowsNotification }

# Cursor 事件

**智能体钩子 (Cmd+K/Agent Chat)** 在智能体会话期间触发：

* `sessionStart` / `sessionEnd` - 会话生命周期管理
* `preToolUse` / `postToolUse` / `postToolUseFailure` - 通用工具使用钩子 (对所有工具都会触发)
* `subagentStart` / `subagentStop` - subagent (Task 工具) 生命周期
* `beforeShellExecution` / `afterShellExecution` - 控制 shell 命令
* `beforeMCPExecution` / `afterMCPExecution` - 控制 MCP 工具使用
* `beforeReadFile` / `afterFileEdit` - 控制文件访问和编辑
* `beforeSubmitPrompt` - 在提交前校验 prompt
* `preCompact` - 监听上下文窗口压缩
* `stop` - 处理 智能体 完成
* `afterAgentResponse` / `afterAgentThought` - 跟踪 智能体 响应

**Tab 钩子 (行内补全)** 为自动化的 Tab 操作触发：

* `beforeTabFileRead` - 控制 Tab 补全的文件访问
* `afterTabFileEdit` - 对 Tab 编辑进行后处理

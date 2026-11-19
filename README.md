# Harness

按编程下面六档摆放的 Harness 展示目录。目录方便浏览。把它放进项目的 `.cursor` 后，Cursor 不会按这个分类路径自动加载。

## 编程

### 前后端 `programming/frontend-backend`

技能：`frontend-patterns`、`backend-patterns`、`ui-ux-pro-max`。

### 代码风格 `programming/code-style`

技能：`coding-standards`、`dev`、`setup-pm`。
钩子：`prettier-format`、`tsc-check`、`console-log-after-edit`、`console-log-stop`、`setup-package-manager`。
规则：`code-shape`。子代理：`refactor-cleaner`、`build-error-resolver`。

### 测试 `programming/testing`

技能：`tdd-workflow`、`test-coverage`、`verification-loop`、`checkpoint`。
规则：`testing`。子代理：`tdd-guide`、`e2e-runner`。

### Harness 自进化 `programming/harness-evolution`

技能：`continuous-learning`、`eval-harness`、`session-record`、`strategic-compact`。
钩子：会话记录、会话起止、`breakpoint`、`evaluate-session`、`pre-compact`、`suggest-compact`、`token_usage_tracker`，以及其余未单独点名的钩子脚本。`breakpoint` 在压缩前为每个对话写下 `log/now/<短号>.md`。
规则：`model-and-context`、`session-record`。

### 安全 `programming/security`

技能：`security-review`。
钩子：`prompt_injection_guard`、`shell_guard`、`sensitive_file_guard`、`hook_utils`。
子代理：`security-reviewer`。

### 流程 `programming/workflow`

技能：`grilling`、`research`、`review`、`orchestrate`。
钩子：`git-push-reminder`、`pr-url`。
规则：`skeleton-projects`。子代理：`code-reviewer`、`doc-updater`、`architect`、`planner`。

## 文档

- `docs/history/`：技能历史。技能正文不记历史。
- `docs/hooks/`：钩子是什么，以及 Cursor 会触发哪些事件。

根目录 `hooks.json` 使用 `python`，脚本路径指向上面的分类目录。本机用户目录写成 `<USER_HOME>`，本机工作区路径写成 `<WORKSPACE>`。

# Harness

给 Cursor 用的技能、钩子、规则和子代理目录，按前后端、代码风格、测试、自进化、安全、流程六档摆放。

# 快速开始

```shell
git clone https://github.com/MingHao00/harness-framework.git
cd harness-framework
```

打开 `programming/`，按下面六档浏览。

# 目录

- [Harness](#harness)
- [快速开始](#快速开始)
- [目录](#目录)
- [安装](#安装)
- [用法](#用法)
- [开发](#开发)
- [贡献](#贡献)
- [许可证](#许可证)

# 安装
[(回到目录)](#目录)

本仓库没有安装包。克隆后即可阅读。

要在 Cursor 项目里使用其中的文件，按 Cursor 自己的目录放入目标项目的 `.cursor`：技能、钩子、规则、子代理各放各的位置。分类路径只供人浏览。

# 用法
[(回到目录)](#目录)

## 前后端 `programming/frontend-backend`

技能：`frontend-patterns`、`backend-patterns`、`ui-ux-pro-max`。

## 代码风格 `programming/code-style`

技能：`coding-standards`、`dev`、`setup-pm`。
钩子：`prettier-format`、`tsc-check`、`console-log-after-edit`、`console-log-stop`、`setup-package-manager`。
规则：`code-shape`。子代理：`refactor-cleaner`、`build-error-resolver`。

## 测试 `programming/testing`

技能：`tdd-workflow`、`test-coverage`、`verification-loop`、`checkpoint`。
规则：`testing`。子代理：`tdd-guide`、`e2e-runner`。

## Harness 自进化 `programming/harness-evolution`

技能：`continuous-learning`、`eval-harness`、`session-record`、`strategic-compact`。
钩子：会话记录、会话起止、`evaluate-session`、`pre-compact`、`suggest-compact`、`token_usage_tracker`，以及其余未单独点名的钩子脚本。
规则：`model-and-context`、`session-record`。

## 安全 `programming/security`

技能：`security-review`。
钩子：`prompt_injection_guard`、`shell_guard`、`sensitive_file_guard`、`hook_utils`。
子代理：`security-reviewer`。

## 流程 `programming/workflow`

技能：`grilling`、`research`、`review`、`orchestrate`。
钩子：`git-push-reminder`、`pr-url`。
规则：`skeleton-projects`。子代理：`code-reviewer`、`doc-updater`、`architect`、`planner`。

## 文档

- `docs/history/`：技能历史。技能正文不记历史。
- `docs/hooks/`：钩子是什么，以及 Cursor 会触发哪些事件。

# 开发
[(回到目录)](#目录)

根目录 `hooks.json` 使用 `python`，脚本路径指向上面的分类目录。本机用户目录写成 `<USER_HOME>`，本机工作区路径写成 `<WORKSPACE>`。

```shell
node --test programming/code-style/hooks/*.test.js programming/workflow/hooks/*.test.js programming/harness-evolution/hooks/*.test.js
python -m pytest programming/security/hooks/test_sensitive_file_guard.py
```

# 贡献
[(回到目录)](#目录)

发现问题可以在本仓库开 [Issue](https://github.com/MingHao00/harness-framework/issues)。

# 许可证
[(回到目录)](#目录)

本仓库还没有 `LICENSE` 文件。

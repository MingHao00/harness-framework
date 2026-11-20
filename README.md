# Harness

给 Cursor 用的技能、钩子、规则和子代理。

> **Harness 用来弥补裸模型的无记忆、不能执行代码、知识过时、缺乏工作环境，把模型的“思考”转成可靠的“行动”。** 这个仓库按六档把日常用的文件摆出来。分类路径只供人浏览。

## 核心

- **技能** — 某类工作怎么做
- **钩子** — 在 Cursor 的事件上检查、记录或拦住
- **规则** — 一直生效的约束
- **子代理** — 分出去做审查、规划或测试

## 怎么放进项目

```
浏览 programming/ 下的六档
挑需要的技能、钩子、规则、子代理
按 Cursor 自己的目录放进项目的 .cursor
钩子是否启用，看根目录 hooks.json
```

## 安装

```shell
git clone https://github.com/MingHao00/harness-framework.git
cd harness-framework
```

没有安装包。克隆后打开 `programming/` 即可浏览。

## 六档

### 前后端 `programming/frontend-backend`

- **技能** — `frontend-patterns`、`backend-patterns`、`ui-ux-pro-max`

### 代码风格 `programming/code-style`

- **技能** — `coding-standards`、`dev`、`setup-pm`
- **钩子** — `prettier-format`、`tsc-check`、`console-log-after-edit`、`console-log-stop`、`setup-package-manager`
- **规则** — `code-shape`
- **子代理** — `refactor-cleaner`、`build-error-resolver`

### 测试 `programming/testing`

- **技能** — `tdd-workflow`、`test-coverage`、`verification-loop`、`checkpoint`
- **规则** — `testing`
- **子代理** — `tdd-guide`、`e2e-runner`

### 自进化 `programming/harness-evolution`

- **技能** — `continuous-learning`、`eval-harness`、`session-record`、`strategic-compact`
- **钩子** — 会话记录、会话起止、`breakpoint`、`evaluate-session`、`pre-compact`、`suggest-compact`、`token_usage_tracker`，以及其余未单独点名的脚本。`breakpoint` 在压缩前为每个对话写下 `log/now/<短号>.md`
- **规则** — `model-and-context`、`session-record`

### 安全 `programming/security`

- **技能** — `security-review`
- **钩子** — `prompt_injection_guard`、`shell_guard`、`sensitive_file_guard`、`hook_utils`
- **子代理** — `security-reviewer`

### 流程 `programming/workflow`

- **技能** — `grilling`、`research`、`review`、`orchestrate`、`knowledge-docs`
- **钩子** — `git-push-reminder`、`pr-url`
- **规则** — `skeleton-projects`
- **子代理** — `code-reviewer`、`doc-updater`、`architect`、`planner`

## 目录

```
harness-framework/
├── programming/
│   ├── frontend-backend/
│   ├── code-style/
│   ├── testing/
│   ├── harness-evolution/
│   ├── security/
│   └── workflow/
├── docs/
│   ├── history/          # 技能历史。技能正文不记历史
│   └── hooks/            # 钩子是什么，以及 Cursor 会触发哪些事件
├── hooks.json            # python 调用上面的脚本。本机路径写成 <USER_HOME>、<WORKSPACE>
└── LICENSE
```

## 开发

```shell
node --test programming/code-style/hooks/*.test.js programming/workflow/hooks/*.test.js programming/harness-evolution/hooks/*.test.js
python -m pytest programming/security/hooks/test_sensitive_file_guard.py
```

发现问题可以在本仓库开 [Issue](https://github.com/MingHao00/harness-framework/issues)。

## 许可证

[MIT](./LICENSE)，Copyright (c) 2026 MingHao00。`programming/frontend-backend/skills/ui-ux-pro-max` 来自 Next Level Builder，Copyright (c) 2024，MIT，声明在该目录的 `LICENSE`。

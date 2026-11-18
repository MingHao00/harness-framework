---
name: eval-harness
description: >-
  用能力评测、回归评测、pass@k 和 1 到 5 分模型判分，评估技能、钩子、规则和子代理的改动。
  用户说定义评测、检查评测、报告评测，或写下 /eval define、/eval check、/eval report 时使用。
  也用于 capability evals、regression evals、/eval 和 .cursor/evals。
  不用于检索、生成或 runs 实验。
---

# 评测框架

在 Cursor 里评估 Harness 改动：技能、钩子、规则、子代理。评测驱动开发的步骤、两种评测、三种判分和 pass@k 保持原样。话题对上就自己读这份技能。

检索、生成和 `runs/` 实验不走这里。

## 原则

- 写实现之前先写期望行为
- 改动过程中反复跑评测
- 每次改动都看回归
- 用 pass@k 看可靠性

## 评测类型

### 能力评测

看这次改动之后，助手或钩子是否做到以前做不到的事。

```markdown
[CAPABILITY EVAL: 名称]
Task: 要完成的事
Success Criteria:
  - [ ] 标准 1
  - [ ] 标准 2
  - [ ] 标准 3
Expected Output: 期望结果
```

### 回归评测

看已有行为还在。

```markdown
[REGRESSION EVAL: 名称]
Baseline: 提交号或检查点
Tests:
  - 已有测试-1: PASS/FAIL
  - 已有测试-2: PASS/FAIL
Result: X/Y passed (previously Y/Y)
```

## 三种判分

能用代码判定就用代码。测试看不出来的开放式行为用模型打分。安全和必须亲眼看的行为交给人。

### 1. 代码判分

用当前仓库已经在用的测试命令。钩子改动跑对应的 `node --test .cursor/hooks/<相关>.test.js`。这个仓库本来用 `npm test` 时才用 npm。不要换成另一套测试命令。

同一条检查默认连续跑 3 次：

- 能力项的 pass@1 只看第 1 次
- 能力项的 pass@3：3 次里至少 1 次通过
- 回归项的 pass^3：3 次全部通过

### 2. 模型判分

测试判定不了时，由当前这场 Cursor 对话打分。不要另接 Claude Code。

```markdown
[MODEL GRADER PROMPT]
Evaluate the following harness change:
1. Does it solve the stated problem?
2. Is it well-structured?
3. Are edge cases handled?
4. Is error handling appropriate?

Score: 1-5 (1=poor, 5=excellent)
Reasoning: [explanation]
```

需要新开一场对话才能看见的行为（有没有读技能、有没有误触发），用户每开始一轮记一次。没有下一轮，就不要写成已经跑了 k 次。

### 3. 人工判定

```markdown
[HUMAN REVIEW REQUIRED]
Change: 改了什么
Reason: 为什么要人看
Risk Level: LOW/MEDIUM/HIGH
```

安全改动必须留人工判定。

## 指标

### pass@k

k 次里至少成功一次。

- pass@1：第 1 次就成功的比例
- pass@3：3 次内成功的比例
- 能力评测的目标：pass@3 > 90%

### pass^k

k 次全部成功。

- pass^3：连续 3 次成功
- 回归评测的目标：pass^3 = 100%

## 流程

### 1. 定义（写代码之前）

写入当前仓库的 `.cursor/evals/<名称>.md`：

```markdown
## EVAL DEFINITION: 名称

### Capability Evals
1. 这次改动新做到的行为

### Regression Evals
1. 已有行为仍然成立

### Success Metrics
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
```

回归如果绑了提交号，把基线写进 `.cursor/evals/baseline.json`。

### 2. 实现

写能通过上述评测的改动。用户还没要求实现时，停在定义。

### 3. 检查

按每条能力评测和回归评测选一种判分，记录 PASS 或 FAIL。代码判分连续跑 3 次。把每一轮追加到 `.cursor/evals/<名称>.log`。

### 4. 报告

按下面的格式写入 `.cursor/evals/<名称>.log` 的末尾，并在回复里给出同一份。

```markdown
EVAL REPORT: 名称
========================

Capability Evals:
  行为-a:     PASS (pass@1)
  行为-b:     PASS (pass@3)
  Overall:    2/2 passed

Regression Evals:
  已有测试:   PASS
  Overall:    1/1 passed

Metrics:
  pass@1: 50% (1/2)
  pass@3: 100% (2/2)

Status: READY FOR REVIEW
```

回归达到 pass^3 时，在对应行写 `PASS (pass^3)`。未达到成功线时，Status 写 `NOT READY`。

## 三种入口

下面两种说法是同一件事。Cursor 没有单独的 `/eval` 程序；读到这份技能后执行。

| 说法 | 做什么 |
| --- | --- |
| 定义评测 名称 / `/eval define 名称` | 写 `.cursor/evals/<名称>.md` |
| 检查评测 名称 / `/eval check 名称` | 跑判分，追加 `.cursor/evals/<名称>.log` |
| 报告评测 名称 / `/eval report 名称` | 按日志写出报告 |

名称用小写字母、数字和连字符。

## 存放

评测放在当前打开的仓库，用相对路径，不写死某一个项目：

```
.cursor/evals/
  名称.md
  名称.log
  baseline.json
```

## 做法

1. 写代码前先有定义。
2. 改动期间重复检查。
3. 把 pass@k 记进日志，方便以后比较。
4. 能用代码判定就用代码判定。
5. 安全改动留给人看。
6. 评测要短，长评测不会被反复跑。
7. 评测文件和代码一起留在仓库里。

## 例子

钩子把无法解析的输入直接忽略，并且不写错误文件。

```markdown
## EVAL: hook-bad-input

### Phase 1: Define
Capability Evals:
- [ ] null、数组、字符串、数字返回 ignored
- [ ] 上述输入不写入 log/errors

Regression Evals:
- [ ] 已有钩子测试仍然通过

### Phase 2: Implement
[改钩子]

### Phase 3: Evaluate
Run: /eval check hook-bad-input
代码判分：node --test .cursor/hooks/<相关>.test.js，连续 3 次

### Phase 4: Report
EVAL REPORT: hook-bad-input
Capability: 2/2 passed (pass@3: 100%)
Regression: 1/1 passed (pass^3: 100%)
Status: READY FOR REVIEW
```

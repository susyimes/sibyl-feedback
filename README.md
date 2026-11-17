# Sibyl Feedback

![Sibyl 系列插画，女预言者面向聊天窗口里的三个选项](https://raw.githubusercontent.com/susyimes/sibyl/2f6fb986d143dfb78b1f9c82733adc05d1d167fe/assets/sibyl.png)

让客户用一条消息评价客服的回答，也能直接写下「我希望你这样答」。

> **现状**　参考实现使用 Node.js 24+ 和内置 SQLite。可以先[在本机体验](#在本机体验)，也可以按[接入规范](SPEC.md)装到客服 Agent 上。

## 它做什么

客户问的是在哪里查退款进度，客服却只答了要等多久。客户可以在原对话里指出漏答的地方。

```text
客户　退款进度在哪看？
客服　退款一般需要几个工作日。

      s1. 答得好
      s2. 答得差
      s3. 我希望你这样答（直接发 s3 加建议，或先发 s3 再写）

客户　s2
客服　已记下差评。
客户　s3 请先告诉我在哪里查进度。
客服　已记下你的建议。
```

这次的差评和建议都会跟着这份回答保存。客户也可以单独发 `s3`，再用下一条消息写建议，支持多行，发 `/cancel` 可退出填写。一次回答可以有多条建议，改评分时以最新一次为准。跳过评价就能直接问下一题。

## 它怎么做到的

- **客服答完时**，`recordAnswer` 保存用户的原问题和客服的完整回答，返回带有三个反馈选项的文本。
- **用户发来消息时**，`receive` 将评分或建议关联到对应的回答。普通新问题继续交给客服处理。

### 与 Sibyl 的关系

这两个接入位置沿用 Sibyl 的做法。`s1`、`s2`、`s3` 的识别直接复用其进化模块的 `classifyReply` 函数，源码随本仓库分发。[查看 Sibyl 原始实现](https://github.com/susyimes/sibyl/blob/2f6fb986d143dfb78b1f9c82733adc05d1d167fe/evolve/learn_core.mjs)

## 安装

把下面这句话发给负责接入的 Agent。

> 请按照 <https://github.com/susyimes/sibyl-feedback/blob/main/SPEC.md> 为当前客服接入 Sibyl Feedback。

### 接到客服 Agent

Node.js 宿主可以直接导入 `FeedbackStore`。下面的示例只为带知识库问题编号的回答收集反馈。其他语言也可以通过命令行传入 JSON。[命令行接入说明](SPEC.md#其他运行环境)

<details>
<summary>查看 Node.js 接入示例</summary>

```js
import { FeedbackStore } from './src/feedback.mjs';

const feedback = new FeedbackStore();

export async function onCustomerText(message, answerCustomer) {
  const { sessionId, messageId, text, replyTo } = message;
  const input = feedback.receive({ sessionId, messageId, text, replyTo });
  if (input.handled) return input.reply;

  const result = await answerCustomer(message);
  if (!result.topic) return result.text;
  return feedback.recordAnswer({
    sessionId, answerId: result.id, question: text, answer: result.text,
    topic: result.topic, version: result.version,
  }).text;
}
```

</details>

运行 `node --test` 可检查反馈归属、重复投递和统计口径。接到真实客服后，可以按规范逐项验收。[手工验收步骤](SPEC.md#手工验收)

## 使用

| 命令 | 作用 |
| --- | --- |
| `node cli.mjs answer` | 保存原始问答，返回带反馈选项的客服回答 |
| `node cli.mjs reply` | 处理客户发来的文本，返回反馈回执或交回客服的标记 |
| `node cli.mjs stats` | 按问题和版本统计回答数、评分和建议 |
| `node cli.mjs export` | 导出 UTF-8 JSONL，每行一份完整问答，附评分、建议原文和时间 |

### 在本机体验

在仓库目录打开 PowerShell，按顺序运行下面的命令，就能在临时目录建一个示例库，录入上面的退款对话并查看结果。

```powershell
$exampleDb = Join-Path ([IO.Path]::GetTempPath()) 'sibyl-feedback-example.sqlite3'

node cli.mjs answer --db "$exampleDb" --session chat-1 --id a1 `
  --topic refund.status --version v1 `
  --question "退款进度在哪看？" --answer "退款一般需要几个工作日。"

node cli.mjs reply --db "$exampleDb" --session chat-1 --id m1 --text "s2"
node cli.mjs reply --db "$exampleDb" --session chat-1 --id m2 `
  --text "s3 请先告诉我在哪里查进度。"

node cli.mjs stats  --db "$exampleDb" --topic refund.status
node cli.mjs export --db "$exampleDb" --topic refund.status
```

## 用反馈改进回答

把“退款在哪查”和“怎么看退款进度”归到同一个问题编号 `topic`，例如 `refund.status`，每次的原问法仍会保留。用 `node cli.mjs export --topic refund.status` 回看建议。如果多位客户都在要查询入口，就可以在新版回答里补上入口，再用原来的问法检验。

更新话术或知识库时传入新的 `version`，就可以用 `node cli.mjs stats --topic refund.status` 比较前后两版。`stats` 和 `export` 都支持 `--version` 筛选。省略 `topic` 时按去除首尾空白的原问题精确分组，省略 `version` 时记为 `unversioned`。

| 统计字段 | 怎么读 |
| --- | --- |
| `answers` | 这个问题在该版本中一共回答了多少次 |
| `rated`、`good`、`bad` | 已评分的回答数，以及其中的好评数、差评数 |
| `suggested` | 收到过文字建议的回答数 |
| `withFeedback` | 收到过评分或建议的回答数。示例里同一回答既有差评又有建议，仍算一次 |
| `badRate` | 差评数除以已评分的回答数。还没有评分时为 `null` |

## 数据存在哪里

默认数据库是 `~/.sibyl-feedback/feedback.sqlite3`。可以通过环境变量 `SIBYL_FEEDBACK_DB` 或命令行参数 `--db` 指定其他位置。Git 默认忽略常见的 SQLite 文件、事务日志、`*.jsonl` 和 `exports/`。

## 仓库地图

| 路径 | 内容 |
| --- | --- |
| [SPEC.md](SPEC.md) | 客服 Agent 的接入规范和手工验收步骤 |
| [cli.mjs](cli.mjs) | 录入问答、处理反馈、统计和导出的命令行入口 |
| [src/feedback.mjs](src/feedback.mjs) · [src/schema.sql](src/schema.sql) | 反馈如何关联到回答，以及 SQLite 如何保存记录 |
| [src/protocol.mjs](src/protocol.mjs) · [vendor/sibyl-reply.mjs](vendor/sibyl-reply.mjs) | 反馈菜单、回执和复用的 Sibyl 输入解析 |
| [test/feedback.test.mjs](test/feedback.test.mjs) | 反馈归属、重复投递和统计用例 |

## 许可证

[MIT](LICENSE)

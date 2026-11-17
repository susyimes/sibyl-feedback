# Sibyl Feedback

给客服 Agent 加三个纯文本反馈选项。每次答完先保存用户的原问题和客服给出的完整回答，用户可以评价，也可以直接问下一题。过一段时间，按同一个问题和不同客服版本回看差评与修改建议。

| 用户在聊天里发什么 | 客服怎么处理 |
| --- | --- |
| `s1` | 给这条回答记好评 |
| `s2` | 给这条回答记差评 |
| `s3 我希望先看到退款进度的查询入口` | 把这段建议追加到这条回答上 |
| 单独发 `s3` | 提示用户直接写。下一条非空文本作为建议原样保存，支持换行。发 `/cancel` 可退出 |

一次回答可以同时有评分和多条建议。用户改评分时以最新一次为准。直接发新问题会继续正常客服对话。

## 接到客服 Agent

可以对负责接入的 Agent 说「请按照 https://github.com/susyimes/sibyl-feedback/blob/main/SPEC.md 为当前客服接入 Sibyl Feedback」。接入位置、消息标识和验收步骤见[接入规范](SPEC.md)。

参考实现使用 Node.js 24+ 和内置 SQLite，下载后即可运行。宿主可以导入 `FeedbackStore`，也可以通过命令行传入 JSON。下面示范只收集客服知识库里已标出问题编号的回答。

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

`topic` 是稳定的问题编号。例如“退款在哪查”和“怎么看退款进度”都可以传 `refund.status`，原问法仍然分别保留。省略编号时按原问题去除首尾空白后的文字精确分组。`version` 用于区分话术或知识库版本，省略时记为 `unversioned`。

## 在本机体验

下面的 PowerShell 示例在临时目录建一个示例库。每条命令都可以单独运行。

```powershell
$exampleDb = Join-Path ([IO.Path]::GetTempPath()) 'sibyl-feedback-example.sqlite3'
node cli.mjs answer --db "$exampleDb" --session chat-1 --id a1 --topic refund.status --version v1 --question "退款进度在哪看？" --answer "退款一般需要几个工作日。"
node cli.mjs reply  --db "$exampleDb" --session chat-1 --id m1 --text "s2"
node cli.mjs reply  --db "$exampleDb" --session chat-1 --id m2 --text "s3 请先告诉我在哪里查进度。"
node cli.mjs stats  --db "$exampleDb" --topic refund.status
node cli.mjs export --db "$exampleDb" --topic refund.status
```

`stats` 按问题和版本列出总回答数 `answers`、评分数 `rated`、好评 `good`、差评 `bad`、有建议的回答数 `suggested` 和收到任意反馈的回答数 `withFeedback`。示例里一份回答收到差评和建议，`withFeedback` 仍然是 1。`badRate` 是差评占已评分回答的比例，尚无评分时为 `null`。

`export` 输出 UTF-8 JSONL，每行一份完整问答，带评分、各条建议原文和时间。两个命令都可以用 `--topic` 或 `--version` 筛选。对某个问题更新话术后，可以用导出的旧问法检验新回答，再按版本观察后续反馈。

默认数据文件是 `~/.sibyl-feedback/feedback.sqlite3`。通过环境变量 `SIBYL_FEEDBACK_DB` 或命令行的 `--db` 可指定其他位置。Git 默认忽略常见的 SQLite 文件、事务日志、`*.jsonl` 和 `exports/`。

可以运行 `node --test` 检查内存数据库中的反馈归属、重复投递和统计口径，也可以按[手工验收步骤](SPEC.md#手工验收)在自己的客服入口测试。

## 与 Sibyl 的关系

沿用 Sibyl 在回合结束与下一条输入之间处理反馈的方式，直接复用进化模块的 `classifyReply` 标签解析函数。该函数随本仓库分发，来源为 [Sibyl 的固定版本](https://github.com/susyimes/sibyl/blob/2f6fb986d143dfb78b1f9c82733adc05d1d167fe/evolve/learn_core.mjs)，遵循 [MIT 许可证](LICENSE)。

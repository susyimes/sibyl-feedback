#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { FeedbackStore } from './src/feedback.mjs';

const help = `Sibyl Feedback · Node.js 24+
  node cli.mjs answer --session <会话> --question <原问题> --answer <实际回答> [--id <回答ID>] [--topic <问题编号>] [--version <版本>]
  node cli.mjs reply  --session <会话> --text <用户原话> [--id <消息ID>] [--to <回答ID>]
  node cli.mjs stats  [--topic <问题编号>] [--version <版本>]
  node cli.mjs export [--topic <问题编号>] [--version <版本>]

所有命令可加 --db <SQLite 文件>。answer 和 reply 可改用 --stdin 从标准输入接收一个 UTF-8 JSON 对象。
stats 输出 JSON，export 每行输出一个回答样本。写入命令在命令行省略 --id 时会生成新 ID。
`;

const fields = {
  answer: ['session', 'id', 'question', 'answer', 'topic', 'version'],
  reply: ['session', 'id', 'text', 'to'],
  stats: ['topic', 'version'],
  export: ['topic', 'version'],
};

async function jsonInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected one JSON object on stdin');
  return value;
}

async function run([command, ...args]) {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (!Object.hasOwn(fields, command)) throw new Error('Unknown command: ' + command);
  const options = Object.fromEntries(['db', ...fields[command]].map((name) => [name, { type: 'string' }]));
  options.help = { type: 'boolean', short: 'h' };
  const writing = command === 'answer' || command === 'reply';
  if (writing) options.stdin = { type: 'boolean' };
  const { values } = parseArgs({ args, options });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  if (values.stdin && fields[command].some((name) => values[name] !== undefined)) {
    throw new Error('When using --stdin, pass the whole event in JSON');
  }
  const input = values.stdin ? await jsonInput() : null;
  const store = new FeedbackStore(values.db);
  try {
    let result;
    if (command === 'answer') {
      result = store.recordAnswer(input ?? {
        sessionId: values.session, answerId: values.id ?? randomUUID(), topic: values.topic,
        version: values.version, question: values.question, answer: values.answer,
      });
    } else if (command === 'reply') {
      result = store.receive(input ?? {
        sessionId: values.session, messageId: values.id ?? randomUUID(), replyTo: values.to, text: values.text,
      });
    } else if (command === 'stats') {
      result = store.stats({ topic: values.topic, version: values.version });
    } else {
      for (const sample of store.samples({ topic: values.topic, version: values.version })) {
        if (!process.stdout.write(JSON.stringify(sample) + '\n')) await once(process.stdout, 'drain');
      }
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

run(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

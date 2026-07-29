#!/usr/bin/env node
/**
 * Manual smoke test against a running API (default http://localhost:3001).
 * Usage: node scripts/smoke.mjs "I need a laptop for work under $1500"
 */
const base = process.env.API_URL ?? 'http://localhost:3001';
const prompt = process.argv[2] ?? 'I need a good laptop for work under $1500';

async function json(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const search = await json('/api/products?query=gaming%20laptop&maxPrice=2000&limit=3');
console.log(`\n[products] source=${search.source} total=${search.total} notes=${JSON.stringify(search.notes)}`);
for (const product of search.products) {
  console.log(`  #${product.id} ${product.title} — $${product.finalPrice} (${product.rating}★)`);
}

const conversation = await json('/api/conversations', { method: 'POST', body: '{}' });
console.log(`\n[conversation] ${conversation.id}`);

const response = await fetch(`${base}/api/conversations/${conversation.id}/messages/stream`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ content: prompt }),
});
console.log(`[stream] status=${response.status} type=${response.headers.get('content-type')}\n`);

const decoder = new TextDecoder();
let buffer = '';
let text = '';
for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';
  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === 'text_delta') {
      text += event.delta;
      process.stdout.write(event.delta);
    } else if (event.type === 'widget') {
      console.log(`\n\n[widget] ${event.widget.heading} (${event.widget.products.length}/${event.widget.total})`);
      for (const product of event.widget.products) {
        console.log(`  #${product.id} ${product.title} — $${product.finalPrice} (${product.rating}★) ${product.thumbnail ? 'img✓' : 'img✗'}`);
      }
    } else if (event.type === 'tool_activity') {
      console.log(`[tool] ${event.activity.state === 'done' ? '✓' : '…'} ${event.activity.label}`);
    } else if (event.type === 'title') {
      console.log(`\n[title] ${event.title}`);
    } else if (event.type === 'error') {
      console.error(`\n[error] ${event.message}`);
    } else if (event.type === 'message') {
      console.log(`\n[final] widgets=${event.message.widgets.length} trace=${JSON.stringify(event.message.toolTrace)}`);
    }
  }
}

const reloaded = await json(`/api/conversations/${conversation.id}`);
console.log(`\n[persisted] title="${reloaded.title}" messages=${reloaded.messages.length}`);
console.log(`[assistant text] ${text.trim().slice(0, 400)}`);

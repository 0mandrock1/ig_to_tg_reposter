import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostText } from '../dist/telegram.js';

test('short media text stays in its caption', () => {
  const text = 'Короткий допис.';
  assert.deepEqual(planPostText(text, true), { caption: text, messages: [] });
});

test('long media text moves intact to a separate message', () => {
  const text = 'Перший абзац.\n\n' + 'Довгий абзац '.repeat(100).trimEnd();
  const plan = planPostText(text, true);
  assert.equal(plan.caption, '');
  assert.deepEqual(plan.messages, [text]);
});

test('long plain text breaks at a paragraph and keeps every word', () => {
  const text = 'Перший абзац '.repeat(180).trimEnd() + '\n\n' + 'Другий абзац '.repeat(180).trimEnd();
  const plan = planPostText(text, false);
  assert.equal(plan.messages.length, 2);
  assert.ok(plan.messages.every((part) => part.length <= 4096));
  assert.equal(plan.messages.join('\n\n'), text);
});

test('long unbroken text never splits an emoji surrogate pair', () => {
  const text = 'а'.repeat(4095) + '🗯️' + 'б'.repeat(100);
  const plan = planPostText(text, false);
  assert.ok(plan.messages.every((part) => part.length <= 4096));
  assert.equal(plan.messages.join(''), text);
});

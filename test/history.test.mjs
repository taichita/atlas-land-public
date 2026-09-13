import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationItems} from '../public/history.js';

const turn = n => ({id: `turn-${n}`, items: [
  {id: `user-${n}`, type: 'userMessage', content: [{type: 'text', text: `Question ${n}`}]},
  {id: `answer-${n}`, type: 'agentMessage', text: `Answer ${n}`},
]});

test('latest twelve turns never replay older cached conversations at the end', () => {
  const all = Array.from({length: 16}, (_, i) => turn(i + 1));
  const live = new Map(all.flatMap(t => t.items.map(i => [i.id, {...i, turnId: t.id}])));
  const recent = all.slice(-12);
  assert.deepEqual(conversationItems({turns: recent, live}).map(i => i.id), recent.flatMap(t => t.items.map(i => i.id)));
  // A UI reload against an older server must fix replay without restarting AI.
  const legacy = new Map(all.flatMap(t => t.items.map(i => [i.id, i])));
  assert.deepEqual(conversationItems({turns: recent, live: legacy}), recent.flatMap(t => t.items));
});

test('current streamed text updates in place and new items appear once', () => {
  const t = turn(16);
  const live = new Map([
    ['answer-1', {id: 'answer-1', turnId: 'turn-1', text: 'old'}],
    ['answer-16', {id: 'answer-16', turnId: 'turn-16', text: 'updated'}],
    ['new', {id: 'new', turnId: 'turn-16', text: 'streaming'}],
  ]);
  const items = conversationItems({turns: [t], live}, t.id);
  assert.deepEqual(items.map(i => i.id), ['user-16', 'answer-16', 'new']);
  assert.equal(items[1].text, 'updated');
  assert.deepEqual(conversationItems({turns: [t], live}), t.items);
});

test('loading older pages keeps chronology and legitimate repeated messages', () => {
  const a = turn(1), b = turn(2);
  b.items[0].content = a.items[0].content;
  assert.deepEqual(conversationItems({turns: [a, b], live: new Map()}), [...a.items, ...b.items]);
});

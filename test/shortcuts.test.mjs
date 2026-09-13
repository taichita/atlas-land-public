import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { shortcutCommand, eventToShortcut, normalizeShortcutBindings, moveTab } from '../public/shortcuts.js';

test('tab shortcuts, Japanese backslash, movement and input exclusions', () => {
  const command = (key, more = {}) => shortcutCommand({ key, ctrlKey: true, ...more });
  assert.equal(command('Tab'), 'next-tab');
  assert.equal(command('Tab', { shiftKey: true }), 'previous-tab');
  assert.equal(command('PageUp'), 'previous-tab-page');
  assert.equal(command('PageDown'), 'next-tab-page');
  assert.equal(command('PageDown', { shiftKey: true }), 'move-tab-right');
  assert.equal(command('Enter'), 'send');
  assert.equal(command('¥', { code: 'IntlYen' }), 'split');
  assert.equal(command('ArrowRight', { altKey: true }), 'focus-right');
  assert.equal(command('t', { isComposing: true }), null);
  assert.equal(command('t', { repeat: true }), null);
  assert.equal(command('v', { ctrlKey: false }), null);
  const tabs = ['a', 'b', 'c'].map((key) => ({ key }));
  assert.deepEqual(moveTab(tabs, 'b', 1).map((t) => t.key), ['a', 'c', 'b']);
  assert.deepEqual(tabs.map((t) => t.key), ['a', 'b', 'c']);
  assert.equal(moveTab(tabs, 'a', -1), tabs);
});

test('custom shortcuts replace defaults and normalize physical keys', () => {
  const bindings = normalizeShortcutBindings({ 'new-tab': 'Ctrl+Alt+N', shortcuts: '' });
  assert.equal(shortcutCommand({ key: 't', code: 'KeyT', ctrlKey: true }, bindings), null);
  assert.equal(shortcutCommand({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }, bindings), 'new-tab');
  assert.equal(shortcutCommand({ key: 'F1', code: 'F1' }, bindings), null);
  assert.equal(eventToShortcut({ key: '¥', code: 'IntlYen', ctrlKey: true }), 'Ctrl+Backslash');
  assert.equal(eventToShortcut({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+=');
});

const mediaCode = await fs.readFile(new URL('../native/media-shortcuts.js', import.meta.url), 'utf8');
function page(rates = [1, 1.5]) {
  const handlers = {}, bridge = {}, requests = [], childMessages = [];
  const videos = rates.map((playbackRate) => ({ playbackRate }));
  const frame = { postMessage: (message) => childMessages.push(message) };
  const document = {
    querySelectorAll: (selector) => selector === 'video' ? videos : [],
    createElement: () => ({ style: {}, setAttribute() {}, remove() { this.isConnected = false; } }),
    documentElement: { appendChild(node) { node.isConnected = true; } },
  };
  const window = { frames: [frame], addEventListener: (name, callback) => { handlers[name] = callback; },
    chrome: { webview: { postMessage: (m) => requests.push(m), addEventListener: (name, cb) => { bridge[name] = cb; } } } };
  window.top = window; window.parent = window;
  vm.runInNewContext(mediaCode, { window, document, setTimeout: () => 1, clearTimeout() {} });
  const key = (key, extra = {}) => {
    let prevented = false;
    handlers.keydown({ key, isTrusted: true, composedPath: () => [], preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...extra });
    return prevented;
  };
  const apply = (extra) => bridge.message({ data: { channel: 'gpt-atlas-media-v1', kind: 'apply', ...extra } });
  return { videos, document, handlers, bridge, requests, childMessages, frame, key, apply };
}
test('V/Z requests only a narrow speed step; all videos change with clamping and late videos', () => {
  const p = page([1, 1.5, 8, 0.25]);
  assert.equal(p.key('v'), true);
  assert.equal(p.requests[0].type, 'atlas.mediaStep');
  assert.equal(p.requests[0].delta, 0.25);
  p.apply({ delta: 0.25 });
  assert.deepEqual(p.videos.map((v) => v.playbackRate), [1.25, 1.75, 8, 0.5]);
  p.videos.push({ playbackRate: 1 });
  p.apply({ delta: -0.25 });
  p.apply({ delta: -0.25 });
  assert.deepEqual(p.videos.map((v) => v.playbackRate), [0.75, 1.25, 7.5, 0.25, 0.5]);
  assert.equal(p.childMessages[0].kind, 'apply');
  p.apply({ delta: 100 });
  assert.equal(p.videos[0].playbackRate, 0.75);
  assert.equal(p.key('z'), true);
  assert.equal(p.requests.at(-1).delta, -0.25);
});
test('media speed keys can be reassigned', () => {
  const p = page();
  p.bridge.message({ data: { channel: 'gpt-atlas-media-v1', kind: 'settings', enabled: true, increase: 'Ctrl+Shift+U', decrease: 'Alt+J' } });
  assert.equal(p.key('v'), false);
  assert.equal(p.key('u', { code: 'KeyU', ctrlKey: true, shiftKey: true }), true);
  assert.equal(p.requests.at(-1).delta, 0.25);
  assert.equal(p.key('j', { code: 'KeyJ', altKey: true }), true);
  assert.equal(p.requests.at(-1).delta, -0.25);
});
test('typing, editable shadow paths, modifiers, synthetic events, IME and disabled keys stay untouched', () => {
  const p = page();
  for (const extra of [
    { isTrusted: false }, { isComposing: true }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    ...['INPUT', 'TEXTAREA', 'SELECT'].map((tagName) => ({ composedPath: () => [{ tagName }] })),
    { composedPath: () => [{ isContentEditable: true }] },
    { composedPath: () => [{ getAttribute: () => 'textbox' }] },
  ]) assert.equal(p.key('v', extra), false);
  assert.equal(p.requests.length, 0);
  p.bridge.message({ data: { channel: 'gpt-atlas-media-v1', kind: 'settings', enabled: false } });
  assert.equal(p.key('v'), false);
  assert.equal(p.requests.length, 0);
});
test('only a child frame can forward a media request', () => {
  const p = page();
  const data = { channel: 'gpt-atlas-media-v1', kind: 'request', delta: 0.25 };
  p.handlers.message({ data, source: {} });
  assert.equal(p.requests.length, 0);
  p.handlers.message({ data, source: p.frame });
  assert.equal(p.requests.length, 1);
});

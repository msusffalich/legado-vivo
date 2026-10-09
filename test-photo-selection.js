'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('photo selection survives the Chromium live FileList and supports additional/removable photos', () => {
  function node() {
    return { children: [], handlers: {}, classList: { add() {}, remove() {} },
      appendChild(child) { child.parentNode = this; this.children.push(child); },
      addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute() {},
      set innerHTML(value) { this.children = []; }, querySelector() { return null; }, remove() {} };
  }
  class Transfer {
    constructor() {
      this.files = [];
      this.items = { add: f => this.files.push(f), remove: i => this.files.splice(i, 1) };
    }
  }
  const input = node(); input.name = 'photo'; input.files = [];
  // Reproduces the real Edge result: clearing the field clears its shared list.
  Object.defineProperty(input, 'value', { set(value) { if (value === '') this.files.length = 0; } });
  const preview = node(), drop = node(), form = node(), parent = node(); input.parentNode = parent;
  const fields = { photo: input, video: node(), audio: node(), document: node() };
  form.querySelector = selector => fields[selector.match(/name="([^"]+)"/)[1]];
  const ids = { 'memory-form': form, 'photo-input': input, 'photo-drop': drop, 'photo-previews': preview };
  const document = { readyState: 'complete', handlers: {}, createElement: node,
    getElementById: id => ids[id], addEventListener(type, fn) { this.handlers[type] = fn; } };
  let urls = 0; const revoked = [];
  const window = {};
  vm.runInNewContext(fs.readFileSync('assets-app.js', 'utf8'), {
    document, window, DataTransfer: Transfer, setTimeout() {},
    URL: { createObjectURL: () => 'blob:' + ++urls, revokeObjectURL: url => revoked.push(url) },
  });
  function select(files) { input.files = files; input.handlers.change(); }
  select([{ name: 'first.png', type: 'image/png' }]);
  assert.deepEqual(input.files.map(f => f.name), ['first.png']);
  assert.equal(preview.children.length, 1);
  select([{ name: 'second.jpg', type: '' }]);
  assert.deepEqual(input.files.map(f => f.name), ['first.png', 'second.jpg']);
  assert.equal(preview.children.length, 2);
  preview.children[0].children[2].handlers.click();
  assert.deepEqual(input.files.map(f => f.name), ['second.jpg']);
  assert.equal(preview.children.length, 1);
  assert(revoked.length > 0);
  drop.handlers.drop({ dataTransfer: { files: [{ name: 'dropped.png', type: 'image/png' }] } });
  assert.deepEqual(input.files.map(f => f.name), ['second.jpg', 'dropped.png']);
  document.handlers.paste({ clipboardData: { files: [{ name: 'pasted.jpeg', type: '' }] }, preventDefault() {} });
  assert.deepEqual(input.files.map(f => f.name), ['second.jpg', 'dropped.png', 'pasted.jpeg']);
});

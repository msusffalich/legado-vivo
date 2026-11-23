'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ejs = require('ejs');

test('multi-select, reselect, drag, paste and retry send only the visible photos and videos', () => {
  function node() {
    return { children: [], handlers: {}, style: {}, classList: { add() {}, remove() {} },
      appendChild(child) { child.parentNode = this; this.children.push(child); },
      addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute() {},
      set innerHTML(value) { this.children = []; }, querySelector() { return null; }, remove() {} };
  }
  const input = node(); input.name = 'photo'; input.files = [];
  input.dataset = { existing: '0', limitMessage: 'Max 10 photos/videos', typeMessage: 'Unsupported type' };
  // Match the real Chromium picker: clearing value empties its shared list.
  Object.defineProperty(input, 'value', { set(value) { if (value === '') this.files.length = 0; } });
  const preview = node(), drop = node(), form = node(), parent = node(), notice = node(), submit = node();
  const progress = node(), bar = node(), status = node(), err = node();
  input.parentNode = parent;
  const fields = { photo: input, video: node(), audio: node(), document: node() };
  form.querySelector = selector => selector.startsWith('button') ? submit : fields[selector.match(/name="([^"]+)"/)[1]];
  const ids = { 'memory-form': form, 'photo-input': input, 'photo-drop': drop, 'photo-previews': preview, 'photo-limit-notice': notice,
    'upload-progress': progress, 'upload-bar-fill': bar, 'upload-status': status, 'upload-error': err };
  const document = { readyState: 'complete', documentElement: { lang: 'en' }, handlers: {}, createElement: node,
    getElementById: id => ids[id], querySelectorAll: () => [], addEventListener(type, fn) { this.handlers[type] = fn; } };
  let urls = 0; const revoked = [];
  const window = { location: {} }, sent = [];
  const audio = new File(['audio'], 'audio.mp3'), doc = new File(['document'], 'story.txt');
  // The uploader must not depend on DataTransfer or writing a native FileList.
  class FakeXHR {
    constructor() { this.events = {}; this.upload = node(); }
    open() {}
    setRequestHeader() {}
    addEventListener(type, fn) { this.events[type] = fn; }
    send(data) { sent.push({ data, xhr: this }); }
  }
  const context = vm.createContext({
    document, window, setTimeout() {}, XMLHttpRequest: FakeXHR,
    FormData: function () {
      const data = new FormData();
      data.append('title', 'Existing text');
      data.append('photo', new File(['stale'], 'stale.jpg'));
      data.append('audio', audio); data.append('document', doc);
      return data;
    },
    URL: { createObjectURL: () => 'blob:' + ++urls, revokeObjectURL: url => revoked.push(url) },
  });
  vm.runInContext(fs.readFileSync('assets-app.js', 'utf8'), context);
  const script = ejs.render(fs.readFileSync('view-inc-uploadprogress.ejs', 'utf8'), { t: key => key }).match(/<script>([\s\S]+)<\/script>/)[1];
  vm.runInContext(script, context);
  function file(name, type) { return new File([name], name, { type }); }
  function select(...files) { input.files = files; input.handlers.change(); }
  function names() {
    const data = new FormData(); window.__lvPhotoDrop.appendTo(data);
    return data.getAll('photo').map(f => f.name);
  }
  select(file('first.png', 'image/png'), file('HEIC.HEIC', ''), file('clip.MOV', 'application/octet-stream'));
  assert.deepEqual(names(), ['first.png', 'HEIC.HEIC', 'clip.MOV']);
  assert.equal(input.files.length, 0);
  assert.equal(preview.children.length, 3);
  select(file('second.raf', 'application/octet-stream'));
  assert.deepEqual(names(), ['first.png', 'HEIC.HEIC', 'clip.MOV', 'second.raf']);
  preview.children[0].children[2].handlers.click();
  assert.deepEqual(names(), ['HEIC.HEIC', 'clip.MOV', 'second.raf']);
  assert(revoked.length > 0);
  drop.handlers.drop({ dataTransfer: { files: [file('dropped.mkv', ''), file('unsupported.zip', ''), file('scan.psd', '')] } });
  assert.match(notice.textContent, /Unsupported type: unsupported.zip/);
  document.handlers.paste({ clipboardData: { files: [file('pasted.jpeg', ''), file('pasted.m2ts', '')] }, preventDefault() {} });
  assert.deepEqual(names(), ['HEIC.HEIC', 'clip.MOV', 'second.raf', 'dropped.mkv', 'scan.psd', 'pasted.jpeg', 'pasted.m2ts']);
  select(...Array.from({ length: 4 }, (_, i) => file('whatsapp-' + i + '.mp4', 'video/mp4')));
  assert.equal(names().length, 10);
  assert.match(notice.textContent, /Max 10/);
  preview.children[9].children[2].handlers.click();
  select(file('whatsapp-2.mp4', 'video/mp4'));
  assert.equal(names().length, 10);
  assert.equal(names()[9], 'whatsapp-2.mp4');
  form.handlers.submit({ preventDefault() {} });
  form.handlers.submit({ preventDefault() {} });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].data.getAll('photo').map(f => f.name), names());
  assert.equal(sent[0].data.get('title'), 'Existing text');
  assert.equal(sent[0].data.get('audio').name, 'audio.mp3');
  assert.equal(sent[0].data.get('document').name, 'story.txt');
  sent[0].xhr.upload.handlers.load();
  assert.equal(status.textContent, 'upload_done');
  sent[0].xhr.events.error();
  assert.notEqual(submit.disabled, true);
  form.handlers.submit({ preventDefault() {} });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].data.getAll('photo').map(f => f.name), names());
});

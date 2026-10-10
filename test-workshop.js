'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { t } = require('./i18n');

test('album creation/edit preserves nonconsecutive selections, order and family isolation', async () => {
  const db = require('./db'), original = db.query;
  let saved, fail = false;
  db.query = async (sql, p) => {
    if (sql.startsWith('SELECT id FROM memories')) { assert.equal(p[0], 2); return { rows: p[1].filter(id => [1, 3, 5].includes(id)).map(id => ({ id })) }; }
    if (fail) throw new Error('Simulated unavailable database');
    if (sql.startsWith('INSERT INTO albums')) { saved = JSON.parse(p[4]); return { rows: [{ id: 9 }] }; }
    if (sql.startsWith('UPDATE albums')) { saved = JSON.parse(p[3]); assert.equal(p[5], 2); return { rows: p[4] === '9' ? [{ id: 9 }] : [] }; }
    throw new Error('Unexpected SQL: ' + sql);
  };
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { req.family = { id: 2 }; req.membership = { role: 'admin' }; req.session = { user: { id: 1 } }; req.lang = 'es'; req.t = key => t('es', key); next(); });
  app.use('/workshop', require('./routes-workshop'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/workshop`;
  const post = (suffix, blocks) => fetch(base + suffix, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ title: 'Prueba', narrative: 'Historia', blocks: JSON.stringify(blocks) }) });
  try {
    const blocks = [{ type: 'memory', id: 5 }, { type: 'story', text: 'Intermedio' }, { type: 'memory', id: 1 }];
    assert.equal((await post('', [...blocks, { type: 'memory', id: 999 }])).status, 200);
    assert.deepEqual(saved.map(b => b.id || b.text), [5, 'Intermedio', 1]);
    assert.equal((await post('/9', [{ type: 'memory', id: 3 }, { type: 'memory', id: 1 }])).status, 200);
    assert.deepEqual(saved.map(b => b.id), [3, 1]);
    assert.equal((await post('', [])).status, 422);
    assert.equal((await post('/999', blocks)).status, 404);
    fail = true; assert.equal((await post('', blocks)).status, 500);
  } finally { db.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('workshop renders valid scripts, sidecars, and restored HTML/PDF downloads in ES/EN', () => {
  for (const lang of ['es', 'en']) {
    const m = { id: 11, title: '"Recuerdo" <prueba>', doc_path: '/uploads/original.pdf' };
    const data = { lang, t: (key, vars) => t(lang, key, vars), family: { id: 2 }, user: { id: 1 }, membership: { role: 'admin' },
      album: null, submitLabel: '', formAction: '/families/2/workshop', memories: [m], persons: [], picks: [{ kind: 'memory', m, checked: false }],
      memDateISO: () => '', fmtMemDate: () => '', fmtDate: () => '', canWrite: true };
    const html = ejs.render(fs.readFileSync('view-album-new.ejs', 'utf8'), data, { filename: path.resolve('view-album-new.ejs') });
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    assert.match(html, /\/memories\/11\/sidecar/);
    assert.match(html, /href="\/uploads\/original.pdf"/);
    assert.match(html, /id="movePosition"/);
    const show = ejs.render(fs.readFileSync('view-album-show.ejs', 'utf8'), {
      ...data, album: { id: 9, title: 'Álbum' }, memCount: 1, items: [{ kind: 'memory', memory: m }],
    }, { filename: path.resolve('view-album-show.ejs') });
    assert.match(show, /\/workshop\/9\/download-html/); assert.match(show, /\/workshop\/9\/download"/);
    assert.match(show, /\/memories\/11\/sidecar/);
  }
});

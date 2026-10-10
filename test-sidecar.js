'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const express = require('express');
const { buildSidecar, diarioTitle, sidecarBaseName } = require('./sidecar');
const { t } = require('./i18n');

test('sidecar preserves stored metadata and never invents an exact date', () => {
  const memory = { memory_date: '2026-10-09', date_precision: 'exact', place: 'Lima: "Perú"\nCallao\u0001' };
  const people = ['Miguel', 'Ana: María', '李'];
  const body = buildSidecar(memory, people);
  assert.match(body, /fecha: "2026-10-09"/);
  assert.match(body, /diario: "\[\[Viernes 9 de octubre de 2026\]\]"/);
  assert.deepEqual(JSON.parse(body.match(/^personas: (.*)$/m)[1]), people);
  assert.equal(JSON.parse(body.match(/^lugar: (.*)$/m)[1]), memory.place);
  for (const date of [null, '', 'not-a-date', '2026-02-30', '2025-02-29', '2026-13-01', '2026-01-00', '2026-10-09 extra']) {
    assert.doesNotMatch(buildSidecar({ ...memory, memory_date: date, created_at: '2026-10-10' }, []), /^(fecha|diario):/m);
  }
  for (const precision of ['unknown', undefined, 'untrusted']) {
    assert.doesNotMatch(buildSidecar({ ...memory, date_precision: precision }, []), /^(fecha|diario):/m);
  }
  const approximate = buildSidecar({ ...memory, date_precision: 'approx' }, []);
  assert.match(approximate, /precision_fecha: "approx"/);
  assert.doesNotMatch(approximate, /^diario:/m);
  assert.equal(diarioTitle('2024-02-29'), 'Jueves 29 de febrero de 2024');
  assert.equal(sidecarBaseName({ doc_name: 'Mi recuerdo.pdf' }), 'Mi recuerdo');
  assert.equal(sidecarBaseName({ title: '  ../Recuerdo\r\n"<>  ' }), 'Recuerdo');
});

test('sidecar download supports Unicode, no document, readers, family isolation and database errors', async () => {
  const db = require('./db'), previous = db.query;
  let fail = false;
  db.query = async (sql, params) => {
    if (sql.includes('FROM families')) return { rows: [{ id: Number(params[0]) }] };
    if (sql.includes('FROM memberships')) return { rows: params[0] === 2 ? [{ role: 'reader' }] : [] };
    if (sql.includes('FROM memories m')) {
      if (fail) throw new Error('Database unavailable');
      assert.match(sql, /memory_date::text/); assert.equal(params[1], 2);
      return { rows: params[0] === 11 ? [{ id: 11, title: 'Recuerdo 李 🎨', memory_date: null, date_precision: 'unknown', place: 'Lima' }] : [] };
    }
    if (sql.includes('FROM persons')) { assert.match(sql, /p.family_id=\$2/); return { rows: [{ name: 'Miguel' }] }; }
    throw new Error('Unexpected SQL');
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = req.get('x-user') ? { user: { id: 1 } } : {};
    req.t = key => t('es', key); res.render = (name, data) => res.json(data); next();
  });
  const { requireAuth, loadFamily } = require('./mw');
  app.use('/families/:fid/memories', requireAuth, loadFamily, require('./routes-memories'));
  app.use((error, req, res, next) => res.status(500).send('Error'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, signed = true) => fetch(base + url, { redirect: 'manual', headers: signed ? { 'x-user': '1' } : {} });
  try {
    const response = await get('/families/2/memories/11/sidecar');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/markdown/);
    assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '---\nlugar: "Lima"\npersonas: ["Miguel"]\n---\n');
    assert.equal((await get('/families/2/memories/11/sidecar', false)).status, 302);
    assert.equal((await get('/families/3/memories/11/sidecar')).status, 403);
    assert.equal((await get('/families/2/memories/12/sidecar')).status, 404);
    assert.equal((await get('/families/2/memories/11bad/sidecar')).status, 404);
    fail = true; assert.equal((await get('/families/2/memories/11/sidecar')).status, 500);
  } finally { db.query = previous; await new Promise(resolve => server.close(resolve)); }
});

test('each memory exposes a translated sidecar link with and without a document', () => {
  for (const lang of ['es', 'en']) for (const doc_path of [null, '/uploads/document.pdf']) {
    const memory = { id: 11, title: 'Recuerdo', doc_path, doc_name: 'document.pdf' };
    const html = ejs.render(fs.readFileSync('view-memory-show.ejs', 'utf8'), {
      family: { id: 2 }, membership: { role: 'reader' }, memory, canWrite: false, persons: [], versions: [], author: null,
      t: (key, args) => t(lang, key, args), fmtMemDate: () => '',
    }, { filename: require('node:path').resolve('view-memory-show.ejs') });
    assert.equal((html.match(/\/memories\/11\/sidecar/g) || []).length, 1);
    assert(html.includes(t(lang, 'sidecar_download')));
  }
});

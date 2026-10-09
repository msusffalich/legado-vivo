'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const ejs = require('ejs');
const { t } = require('./i18n');

function unzipStored(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const files = new Map();
  let at = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < buffer.readUInt16LE(end + 10); n++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const size = buffer.readUInt32LE(at + 24), nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    files.set(name, buffer.subarray(start, start + size));
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

test('HTML export covers legacy/current albums, galleries, media and access controls', async () => {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-html-test-'));
  const oldUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadDir;
  const binary = require('ffmpeg-static');
  function fixture(args, name) {
    const result = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', ...args, '-y', path.join(uploadDir, name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  fixture(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=0.1', '-frames:v', '1'], 'first.jpg');
  fs.copyFileSync(path.join(uploadDir, 'first.jpg'), path.join(uploadDir, 'second.jpg'));
  fixture(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1'], 'audio.wav');
  fixture(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=0.1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'], 'video.mp4');
  fs.writeFileSync(path.join(uploadDir, 'document.txt'), 'Original document');
  const memory = { id: 11, family_id: 2, title: 'Antes de octubre', memory_date: '2020-01-02',
    photo_path: '/uploads/first.jpg', audio_path: '/uploads/audio.wav', video_path: '/uploads/video.mp4',
    doc_path: '/uploads/document.txt', doc_name: 'Documento', story: '<script>never execute</script>' };
  const albums = {
    1: { id: 1, family_id: 2, title: 'Álbum antiguo', created_at: '2026-09-01', memory_ids: [11, 77] },
    2: { id: 2, family_id: 2, title: 'Actual', created_at: '2026-10-08', memory_ids: [{ type: 'story', title: 'Capítulo', text: 'Historia intermedia' }, { type: 'memory', id: 11 }] },
    3: { id: 3, family_id: 2, title: 'Ausentes', created_at: '2026-09-01', memory_ids: [12, 999] },
  };
  const writes = [];
  const db = require('./db');
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { writes.push(sql); throw new Error('No database writes allowed'); }
    if (sql.includes('FROM families')) return { rows: [{ id: Number(params[0]), name: 'Familia' }] };
    if (sql.includes('FROM memberships')) return { rows: Number(params[0]) === 2 ? [{ role: 'reader' }] : [] };
    if (sql.includes('FROM albums')) return { rows: albums[params[0]] && Number(params[1]) === 2 ? [albums[params[0]]] : [] };
    if (sql.includes('SELECT * FROM memories WHERE id = ANY')) {
      assert.match(sql, /family_id=\$2/); assert.equal(params[1], 2);
      return { rows: params[0].includes(11) ? [{ ...memory }] : [{ id: 12, family_id: 2, title: 'Archivo ausente', photo_path: '/uploads/missing.jpg' }] };
    }
    if (sql.includes('FROM memory_photos')) return { rows: params[0].includes(11) ? [
      { memory_id: 11, photo_path: '/uploads/first.jpg' }, { memory_id: 11, photo_path: '/uploads/second.jpg' },
    ] : [] };
    if (sql.includes('FROM persons')) return { rows: [] };
    throw new Error('Unexpected query: ' + sql);
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = req.get('x-test-user') ? { user: { id: 1 } } : {};
    req.lang = req.get('x-test-lang') || 'es'; req.t = (key) => t(req.lang, key);
    res.render = (name, values) => res.json(values);
    next();
  });
  const { requireAuth, loadFamily } = require('./mw');
  app.use('/families/:fid/workshop', requireAuth, loadFamily, require('./routes-workshop'));
  app.use((err, req, res, next) => res.status(500).send(err.message));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/families`;
  async function request(route, signedIn = true, lang = 'es') {
    return fetch(base + route, { redirect: 'manual', headers: signedIn ? { 'x-test-user': '1', 'x-test-lang': lang } : {} });
  }
  try {
    for (const id of [1, 2]) {
      const response = await request(`/2/workshop/${id}/download-html`, true, id === 2 ? 'en' : 'es');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/zip');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, Number(response.headers.get('content-length')));
      const entries = unzipStored(bytes), html = entries.get('album.html').toString('utf8');
      assert.equal((html.match(/<img /g) || []).length, 2);
      assert.match(html, /data:video\/mp4;base64,/); assert.match(html, /data:audio\/mpeg;base64,/);
      assert.match(html, /&lt;script&gt;never execute&lt;\/script&gt;/);
      assert.equal(entries.get('medios/archivo-0001.txt').toString(), 'Original document');
      assert(!html.includes('77')); // Foreign-family memory is not resolved.
      if (id === 2) { assert.match(html, /Historia intermedia/); assert.match(html, /lang="en"/); }
      if (id === 1) fs.writeFileSync(path.join(uploadDir, 'verified.zip'), bytes);
    }
    const missing = await request('/2/workshop/3/download-html');
    assert.equal(missing.status, 200);
    assert.match(unzipStored(Buffer.from(await missing.arrayBuffer())).get('album.html').toString(), /Archivo no disponible/);
    assert.equal((await request('/2/workshop/999/download-html')).status, 404);
    assert.equal((await request('/3/workshop/1/download-html')).status, 403);
    assert.equal((await request('/2/workshop/1/download-html', false)).status, 302);
    const rendered = ejs.render(fs.readFileSync('view-album-show.ejs', 'utf8'), {
      family: { id: 2 }, membership: { role: 'reader' }, album: albums[1], canWrite: false, items: [], memCount: 0,
      t: key => t('es', key), fmtDate: String, fmtMemDate: String,
    }, { filename: path.resolve('view-album-show.ejs') });
    assert.match(rendered, /\/workshop\/1\/download-html/);
    assert.match(rendered, /Descargar HTML/);
    assert.equal(writes.length, 0);
    console.log('ZIP fixture:', path.join(uploadDir, 'verified.zip'));
  } finally {
    db.query = originalQuery;
    if (oldUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = oldUploadDir;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

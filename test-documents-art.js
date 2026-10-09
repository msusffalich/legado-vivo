'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ejs = require('ejs');
const PDFDocument = require('pdfkit');
const { t } = require('./i18n');
const { albumZip } = require('./album-html');
const { extractDocText } = require('./doc-extract');

async function pdf(text) {
  const doc = new PDFDocument();
  const parts = [];
  const complete = new Promise((resolve, reject) => { doc.on('data', c => parts.push(c)); doc.on('end', () => resolve(Buffer.concat(parts))); doc.on('error', reject); });
  doc.text(text); doc.end();
  return complete;
}
async function word(text) {
  const entries = [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`],
  ].map(([name, text]) => ({ name, data: Buffer.from(text) }));
  const chunks = []; for await (const chunk of albumZip(entries)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('documents extract PDF/Word/text, persist searchable narrative and enforce 25 MB; art preserves originals', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-docs-test-'));
  const priorDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const records = new Map();
  const originalPhoto = Buffer.from('original-photo-kept');
  fs.writeFileSync(path.join(dir, 'original.jpg'), originalPhoto);
  records.set(108, { id: 108, family_id: 2, title: 'Anterior', photo_path: '/uploads/original.jpg', story: '', doc_text: '' });
  const photos = new Map(); let sequence = 200;
  const db = require('./db'), oldQuery = db.query;
  db.query = async (sql, values) => {
    if (sql.includes('FROM families')) return { rows: [{ id: Number(values[0]), name: 'Familia' }] };
    if (sql.includes('FROM memberships')) return { rows: Number(values[0]) === 2 ? [{ role: 'admin' }] : [] };
    if (/INSERT INTO memories /.test(sql)) {
      const id = sequence++;
      records.set(id, { id, family_id: values[0], title: values[1], story: values[2], doc_path: values[16], doc_name: values[17], doc_text: values[18] });
      return { rows: [{ id }] };
    }
    if (sql.includes('FROM memories WHERE id=$1 AND family_id=$2')) {
      const m = records.get(Number(values[0])); return { rows: m && m.family_id === values[1] ? [{ ...m }] : [] };
    }
    if (sql.includes('FROM memories WHERE family_id=$1 AND')) {
      assert.match(sql, /doc_text ILIKE \$2/);
      const term = values[1].slice(1, -1);
      return { rows: [...records.values()].filter(m => m.family_id === values[0] && m.doc_text.includes(term)) };
    }
    if (sql.includes('MAX(sort_order)')) return { rows: [{ m: -1 }] };
    if (sql.includes('SELECT id, photo_path FROM memory_photos')) return { rows: photos.get(values[0]) || [] };
    if (sql.includes('INSERT INTO memory_photos')) {
      const list = photos.get(values[0]) || []; list.push({ id: list.length + 1, photo_path: values[1] }); photos.set(values[0], list); return { rows: [] };
    }
    if (sql.includes('photo_path = COALESCE')) { const m = records.get(values[1]); m.photo_path ||= values[0]; return { rows: [] }; }
    if (sql.includes('FROM persons') || sql.includes('FROM stories') || sql.includes('FROM memory_people')) return { rows: [] };
    if (sql.includes('DELETE FROM memory_people')) return { rows: [] };
    throw new Error('Unexpected query: ' + sql);
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 1 } }; req.lang = 'es'; req.t = (key, vars) => t('es', key, vars);
    res.render = (name, locals) => res.json(locals); next();
  });
  const { requireAuth, loadFamily } = require('./mw');
  app.use('/families/:fid/memories', requireAuth, loadFamily, require('./routes-memories'));
  app.use('/families/:fid/search', requireAuth, loadFamily, require('./routes-search'));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/families/2`;
  async function upload(name, bytes, route = '/memories', field = 'document') {
    const data = new FormData(); data.append('title', 'Documento de prueba'); data.append(field, new Blob([bytes]), name);
    return fetch(base + route, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, body: data });
  }
  try {
    for (const [name, bytes, keyword] of [
      ['prueba.pdf', await pdf('NarrativaPDF2026'), 'NarrativaPDF2026'],
      ['prueba.docx', await word('NarrativaWord2026'), 'NarrativaWord2026'],
      ['prueba.txt', Buffer.from('Relato '.repeat(4000) + 'FinalBuscable2026'), 'FinalBuscable2026'],
    ]) {
      const response = await upload(name, bytes); assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json(), id = Number(result.redirect.split('/').pop());
      assert(records.get(id).doc_text.includes(keyword));
      const search = await fetch(base + '/search?q=' + keyword); const found = await search.json();
      assert(found.memories.some(m => m.id === id));
    }
    const utf16 = path.join(dir, 'unicode.txt');
    fs.writeFileSync(utf16, Buffer.concat([Buffer.from([255, 254]), Buffer.from('Narrativa de año y niñez', 'utf16le')]));
    assert.equal((await extractDocText(utf16, 'unicode.txt')).text, 'Narrativa de año y niñez');
    const boundary = Buffer.alloc(25 * 1024 * 1024, 32); Buffer.from('DocumentoLimite25MB').copy(boundary, boundary.length - 19);
    assert.equal((await upload('limite.txt', boundary)).status, 200);
    const beforeCount = records.size;
    const oversized = await upload('grande.txt', Buffer.alloc(25 * 1024 * 1024 + 1, 32));
    assert.equal(oversized.status, 400); assert.equal(records.size, beforeCount);
    const damaged = await upload('danado.pdf', Buffer.from('not a PDF'));
    assert.equal(damaged.status, 400); assert.equal(records.size, beforeCount);
    const damagedEdit = await upload('danado.pdf', Buffer.from('not a PDF'), '/memories/108');
    assert.equal(damagedEdit.status, 400);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'original.jpg')), originalPhoto);
    const editor = await (await fetch(base + '/memories/108/art')).json();
    assert.equal(editor.photos[0].photo_path, '/uploads/original.jpg');
    const saved = await upload('estilo-carboncillo.jpg', Buffer.from('artistic-copy'), '/memories/108/art-photo', 'artphoto');
    assert.equal(saved.status, 200);
    const art = await saved.json(); assert.equal(art.ok, true);
    assert.notEqual(art.photo_path, records.get(108).photo_path);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'original.jpg')), originalPhoto);
    assert.equal(photos.get(108).length, 1);
    const html = ejs.render(fs.readFileSync('view-memory-show.ejs', 'utf8'), {
      family: { id: 2 }, membership: { role: 'admin' }, memory: { id: 108, title: 'Sin fotos', photos: [] },
      canWrite: true, persons: [], versions: [], author: null, t: key => t('es', key), fmtMemDate: () => '',
    }, { filename: path.resolve('view-memory-show.ejs') });
    assert.match(html, /\/memories\/108\/art/);
    console.log('Verified PDF, DOCX, searchable text beyond 20k, 25 MB boundary, legacy art source and preserved original.');
  } finally {
    db.query = oldQuery; if (priorDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = priorDir;
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
});

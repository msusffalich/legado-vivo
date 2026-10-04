'use strict';
const express = require('express');
const db = require('./db');
const { canWrite, requireAdmin } = require('./mw');
const { generateAlbumPDF } = require('./pdfgen');
const { THEME_IDS } = require('./album-themes');
const { prepareAlbumHTML, albumZip } = require('./album-html');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const router = express.Router({ mergeParams: true });

function cleanTheme(v) {
  return THEME_IDS.includes(v) ? v : 'general';
}

async function withPeople(rows) {
  for (const m of rows) {
    const { rows: p } = await db.query(
      'SELECT p.name FROM persons p JOIN memory_people mp ON mp.person_id=p.id WHERE mp.memory_id=$1 ORDER BY p.name', [m.id]);
    m.people_names = p.map((x) => x.name).join(', ');
  }
  return rows;
}

// Recuerdos completos + personas, listos para el armador (filtros y orden manual).
async function builderData(familyId) {
  const { rows } = await db.query(
    "SELECT * FROM memories WHERE family_id=$1 AND status='complete' ORDER BY memory_date NULLS LAST, created_at",
    [familyId]);
  const { rows: pers } = await db.query('SELECT id, name FROM persons WHERE family_id=$1 ORDER BY name', [familyId]);
  const persById = new Map(pers.map((p) => [p.id, p.name]));
  const { rows: mp } = await db.query(
    'SELECT mp.memory_id, mp.person_id FROM memory_people mp JOIN memories m ON m.id=mp.memory_id WHERE m.family_id=$1',
    [familyId]);
  const byMem = {};
  for (const r of mp) { (byMem[r.memory_id] = byMem[r.memory_id] || []).push(r.person_id); }
  for (const m of rows) {
    const pids = byMem[m.id] || [];
    m.people_ids = pids;
    m.people_names = pids.map((id) => persById.get(id)).filter(Boolean).join(', ');
  }
  return { memories: rows, persons: pers };
}

// El contenido del álbum es una lista ordenada de bloques:
//   { type: 'memory', id }            → un recuerdo
//   { type: 'story', title, text }    → historia intermedia (icono + mini-historia)
// Formato anterior: [12, 7] (solo ids) → se normaliza a bloques de recuerdo.
function normalizeBlocks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((b) => {
    if (typeof b === 'number' && b > 0) return { type: 'memory', id: b };
    if (b && b.type === 'story') {
      return { type: 'story', title: String(b.title || '').slice(0, 200), text: String(b.text || '').slice(0, 5000) };
    }
    if (b && b.type === 'memory' && parseInt(b.id, 10) > 0) return { type: 'memory', id: parseInt(b.id, 10) };
    return null;
  }).filter(Boolean);
}

// Valida los bloques enviados por el formulario: los recuerdos deben existir en
// esta familia (se conserva el orden), las historias se recortan y las vacías se descartan.
async function cleanBlocks(familyId, rawJson) {
  let parsed = [];
  try { parsed = JSON.parse(rawJson || '[]'); } catch (e) { parsed = []; }
  const blocks = normalizeBlocks(parsed);
  const ids = blocks.filter((b) => b.type === 'memory').map((b) => b.id);
  let ok = new Set();
  if (ids.length) {
    const { rows } = await db.query('SELECT id FROM memories WHERE family_id=$1 AND id = ANY($2)', [familyId, ids]);
    ok = new Set(rows.map((r) => r.id));
  }
  return blocks.filter((b) => {
    if (b.type === 'memory') return ok.has(b.id);
    return b.title.trim() || b.text.trim();
  });
}

function blocksMemoryIds(blocks) {
  return blocks.filter((b) => b.type === 'memory').map((b) => b.id);
}

// Resuelve los bloques a ítems ordenados listos para la vista y el PDF.
async function resolveItems(blocks) {
  const ids = blocksMemoryIds(blocks);
  const byId = new Map();
  if (ids.length) {
    const { rows } = await db.query('SELECT * FROM memories WHERE id = ANY($1)', [ids]);
    for (const m of rows) byId.set(m.id, m);
    await withPeople([...byId.values()]);
  }
  return blocks
    .map((b) => (b.type === 'story'
      ? { kind: 'story', title: b.title, text: b.text }
      : (byId.has(b.id) ? { kind: 'memory', memory: byId.get(b.id) } : null)))
    .filter(Boolean);
}

router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM albums WHERE family_id=$1 ORDER BY created_at DESC', [req.family.id]);
  for (const a of rows) {
    a.count = blocksMemoryIds(normalizeBlocks(a.memory_ids)).length;
  }
  res.render('view-layout', {
    page: 'view-workshop', title: req.t('workshop'),
    family: req.family, membership: req.membership, albums: rows,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

router.get('/new', canWrite, async (req, res) => {
  const { memories, persons } = await builderData(req.family.id);
  res.render('view-layout', {
    page: 'view-album-new', title: req.t('new_album'),
    family: req.family, membership: req.membership, memories, persons,
    picks: memories.map((m) => ({ kind: 'memory', m, checked: false })),
    album: null, formAction: null, submitLabel: null,
  });
});

router.post('/', canWrite, async (req, res) => {
  try {
    const blocks = await cleanBlocks(req.family.id, req.body.blocks);
    const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled album' : 'Álbum sin título');
    const narrative = (req.body.narrative || '').trim();
    const theme = cleanTheme(req.body.theme);
    if (!blocks.length) return res.status(422).json({ ok: false, error: 'empty_album' });
    const { rows: ins } = await db.query(
      'INSERT INTO albums (family_id, title, narrative, theme, memory_ids, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.family.id, title, narrative, theme, JSON.stringify(blocks), req.session.user.id]
    );
    req.session.flash = req.t('album_created');
    if (String(req.get('accept') || '').includes('application/json')) {
      return res.json({ ok: true, redirect: `/families/${req.family.id}/workshop/${ins[0].id}` });
    }
    res.redirect(`/families/${req.family.id}/workshop/${ins[0].id}`);
  } catch (err) {
    console.error('[album:create]', err);
    res.status(500).json({ ok: false, error: 'album_save_failed' });
  }
});

// Editar álbum: mismo armador, con los bloques del álbum primero (en su orden).
router.get('/:aid/edit', canWrite, async (req, res) => {
  const { rows: ar } = await db.query('SELECT * FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
  if (!ar.length) return res.redirect(`/families/${req.family.id}/workshop`);
  const album = ar[0];
  const blocks = normalizeBlocks(album.memory_ids);
  const { memories, persons } = await builderData(req.family.id);
  const byId = new Map(memories.map((m) => [m.id, m]));
  const picks = [];
  for (const b of blocks) {
    if (b.type === 'story') picks.push({ kind: 'story', title: b.title, text: b.text });
    else if (byId.has(b.id)) { const m = byId.get(b.id); m._checked = true; picks.push({ kind: 'memory', m, checked: true }); byId.delete(b.id); }
  }
  for (const m of byId.values()) picks.push({ kind: 'memory', m, checked: false });
  res.render('view-layout', {
    page: 'view-album-new', title: req.t('edit_album'),
    family: req.family, membership: req.membership,
    memories, persons, album, picks,
    formAction: `/families/${req.family.id}/workshop/${album.id}`,
    submitLabel: req.t('save_changes'),
  });
});

router.post('/:aid', canWrite, async (req, res) => {
  try {
    const blocks = await cleanBlocks(req.family.id, req.body.blocks);
    const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled album' : 'Álbum sin título');
    const narrative = (req.body.narrative || '').trim();
    const theme = cleanTheme(req.body.theme);
    if (!blocks.length) return res.status(422).json({ ok: false, error: 'empty_album' });
    const updated = await db.query('UPDATE albums SET title=$1, narrative=$2, theme=$3, memory_ids=$4 WHERE id=$5 AND family_id=$6 RETURNING id',
      [title, narrative, theme, JSON.stringify(blocks), req.params.aid, req.family.id]);
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'album_not_found' });
    req.session.flash = req.t('album_updated');
    if (String(req.get('accept') || '').includes('application/json')) {
      return res.json({ ok: true, redirect: `/families/${req.family.id}/workshop/${req.params.aid}` });
    }
    res.redirect(`/families/${req.family.id}/workshop/${req.params.aid}`);
  } catch (err) {
    console.error('[album:update]', err);
    res.status(500).json({ ok: false, error: 'album_save_failed' });
  }
});

router.get('/:aid', async (req, res) => {
  const { rows } = await db.query(
    'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
    [req.params.aid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const album = rows[0];
  const items = await resolveItems(normalizeBlocks(album.memory_ids));
  const memCount = items.filter((it) => it.kind === 'memory').length;
  res.render('view-layout', {
    page: 'view-album-show', title: album.title,
    family: req.family, membership: req.membership, album, items, memCount,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

router.get('/:aid/download', async (req, res) => {
  const { rows } = await db.query(
    'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
    [req.params.aid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const album = rows[0];
  const items = await resolveItems(normalizeBlocks(album.memory_ids));
  const pdf = await generateAlbumPDF({ family: req.family, album, items, lang: req.lang });
  const fname = album.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'album';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
  res.send(pdf);
});

router.get('/:aid/download-html', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
      [req.params.aid, req.family.id]);
    if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
    const album = rows[0];
    const items = await resolveItems(normalizeBlocks(album.memory_ids));
    const archive = await prepareAlbumHTML({ family: req.family, album, items, lang: req.lang });
    const filename = String(album.title || 'album').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'album';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-HTML.zip"`);
    res.setHeader('Content-Length', String(archive.size));
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(Readable.from(albumZip(archive.entries)), res);
  } catch (err) {
    console.error('[album:html]', err);
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(err); return; }
    res.removeHeader('Content-Length');
    res.removeHeader('Content-Disposition');
    res.removeHeader('Content-Type');
    const large = err.code === 'ALBUM_TOO_LARGE';
    const message = large
      ? (req.lang === 'en' ? 'This album is too large for one ZIP (4 GB). Create smaller albums and download them separately.' : 'Este álbum supera el límite de un ZIP (4 GB). Crea álbumes más pequeños y descárgalos por separado.')
      : (req.lang === 'en' ? 'The download could not be completed. Your saved album is intact; please try again.' : 'No se pudo completar la descarga. Tu álbum guardado se conserva; vuelve a intentarlo.');
    res.status(large ? 413 : 500).render('view-layout', { page: 'view-error', title: 'HTML', message });
  }
});

router.post('/:aid/delete', canWrite, async (req, res) => {
  await db.query('DELETE FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
  req.session.flash = req.t('album_deleted');
  res.redirect(`/families/${req.family.id}/workshop`);
});

module.exports = router;

'use strict';
const express = require('express');
const db = require('./db');
const { canWrite, requireAdmin } = require('./mw');
const { generateAlbumPDF } = require('./pdfgen');
const { buildAlbumMarkdown, albumMarkdownName } = require('./album-markdown');
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
async function resolveItems(blocks, familyId) {
  const ids = blocksMemoryIds(blocks);
  const byId = new Map();
  if (ids.length) {
    const { rows } = await db.query('SELECT * FROM memories WHERE id = ANY($1) AND family_id=$2', [ids, familyId]);
    for (const m of rows) byId.set(m.id, m);
    await withPeople([...byId.values()]);
    const { rows: photos } = await db.query(
      'SELECT mp.memory_id, mp.photo_path FROM memory_photos mp JOIN memories m ON m.id=mp.memory_id WHERE mp.memory_id = ANY($1) AND m.family_id=$2 ORDER BY mp.sort_order, mp.id',
      [ids, familyId]);
    for (const photo of photos) {
      const memory = byId.get(photo.memory_id);
      if (memory) (memory.photo_paths = memory.photo_paths || []).push(photo.photo_path);
    }
    const { rows: videos } = await db.query(
      'SELECT mv.memory_id, mv.video_path FROM memory_videos mv JOIN memories m ON m.id=mv.memory_id WHERE mv.memory_id = ANY($1) AND m.family_id=$2 ORDER BY mv.sort_order, mv.id', [ids, familyId]);
    for (const video of videos) {
      const memory = byId.get(video.memory_id);
      if (memory) (memory.video_paths = memory.video_paths || []).push(video.video_path);
    }
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
  const items = await resolveItems(normalizeBlocks(album.memory_ids), req.family.id);
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
  const items = await resolveItems(normalizeBlocks(album.memory_ids), req.family.id);
  const pdf = await generateAlbumPDF({ family: req.family, album, items, lang: req.lang });
  const fname = album.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'album';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
  res.send(pdf);
});

// One Markdown file for the saved album, preserving memory and story order.
router.get('/:aid/download-md', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
    if (!rows.length) return res.status(404).send(req.t('not_found'));
    const album = rows[0], blocks = normalizeBlocks(album.memory_ids), ids = blocksMemoryIds(blocks);
    const byId = new Map();
    if (ids.length) {
      const { rows: memories } = await db.query('SELECT m.*, m.memory_date::text AS memory_date FROM memories m WHERE m.id = ANY($1) AND m.family_id=$2', [ids, req.family.id]);
      const { rows: people } = await db.query('SELECT mp.memory_id, p.name FROM memory_people mp JOIN persons p ON p.id=mp.person_id JOIN memories m ON m.id=mp.memory_id WHERE mp.memory_id = ANY($1) AND m.family_id=$2 AND p.family_id=$2 ORDER BY p.name', [ids, req.family.id]);
      for (const m of memories) byId.set(m.id, { ...m, people: [] });
      for (const p of people) if (byId.has(p.memory_id)) byId.get(p.memory_id).people.push(p.name);
    }
    const items = blocks.map(b => b.type === 'story' ? { kind: 'story', title: b.title, text: b.text } : byId.has(b.id) ? { kind: 'memory', memory: byId.get(b.id) } : null).filter(Boolean);
    res.attachment(albumMarkdownName(album));
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buildAlbumMarkdown({ album, items, lang: req.lang }));
  } catch (error) { next(error); }
});

// The same on-demand export works for legacy numeric ids and current story blocks.
// Authentication and family membership are enforced by the parent router.
router.get('/:aid/download-html', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
      [req.params.aid, req.family.id]);
    if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
    const album = rows[0];
    const items = await resolveItems(normalizeBlocks(album.memory_ids), req.family.id);
    const { entries, size } = await prepareAlbumHTML({ family: req.family, album, items, lang: req.lang });
    const fname = album.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'album';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}-html.zip"`);
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(Readable.from(albumZip(entries)), res);
  } catch (err) {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(err); return; }
    if (err.code === 'ALBUM_TOO_LARGE' || err.code === 'MEDIA_CONVERSION_FAILED') {
      return res.status(err.code === 'ALBUM_TOO_LARGE' ? 413 : 422).render('view-layout', {
        page: 'view-error', title: 'HTML', message: req.t(err.code === 'ALBUM_TOO_LARGE' ? 'album_html_too_large' : 'album_html_media_error'),
      });
    }
    next(err);
  }
});

router.post('/:aid/delete', canWrite, async (req, res) => {
  await db.query('DELETE FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
  req.session.flash = req.t('album_deleted');
  res.redirect(`/families/${req.family.id}/workshop`);
});

module.exports = router;

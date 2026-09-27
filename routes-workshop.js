'use strict';
const express = require('express');
const db = require('./db');
const { canWrite, requireAdmin } = require('./mw');
const { generateAlbumPDF } = require('./pdfgen');
const { THEME_IDS } = require('./album-themes');

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

// Normaliza los ids enviados por el formulario: enteros, de esta familia,
// en el orden exacto en que el usuario los dejó en la lista.
async function cleanIds(familyId, raw) {
  let ids = raw || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map((x) => parseInt(x, 10)).filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await db.query('SELECT id FROM memories WHERE family_id=$1 AND id = ANY($2)', [familyId, ids]);
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((id) => ok.has(id));
}

router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM albums WHERE family_id=$1 ORDER BY created_at DESC', [req.family.id]);
  for (const a of rows) {
    const ids = Array.isArray(a.memory_ids) ? a.memory_ids : [];
    a.count = ids.length;
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
    album: null, formAction: null, submitLabel: null,
  });
});

router.post('/', canWrite, async (req, res) => {
  const ids = await cleanIds(req.family.id, req.body.memory_ids);
  const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled album' : 'Álbum sin título');
  const narrative = (req.body.narrative || '').trim();
  const theme = cleanTheme(req.body.theme);
  if (!ids.length) return res.redirect(`/families/${req.family.id}/workshop/new`);
  const { rows: ins } = await db.query(
    'INSERT INTO albums (family_id, title, narrative, theme, memory_ids, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.family.id, title, narrative, theme, JSON.stringify(ids), req.session.user.id]
  );
  req.session.flash = req.t('album_created');
  res.redirect(`/families/${req.family.id}/workshop/${ins[0].id}`);
});

// Editar álbum: mismo armador, con los recuerdos del álbum primero (en su orden) y marcados.
router.get('/:aid/edit', canWrite, async (req, res) => {
  const { rows: ar } = await db.query('SELECT * FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
  if (!ar.length) return res.redirect(`/families/${req.family.id}/workshop`);
  const album = ar[0];
  const albumIds = Array.isArray(album.memory_ids) ? album.memory_ids : [];
  const { memories, persons } = await builderData(req.family.id);
  const byId = new Map(memories.map((m) => [m.id, m]));
  const inAlbum = albumIds.map((id) => byId.get(id)).filter(Boolean);
  const rest = memories.filter((m) => !albumIds.includes(m.id));
  res.render('view-layout', {
    page: 'view-album-new', title: req.t('edit_album'),
    family: req.family, membership: req.membership,
    memories: [...inAlbum, ...rest], persons, album,
    formAction: `/families/${req.family.id}/workshop/${album.id}`,
    submitLabel: req.t('save_changes'),
  });
});

router.post('/:aid', canWrite, async (req, res) => {
  const ids = await cleanIds(req.family.id, req.body.memory_ids);
  const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled album' : 'Álbum sin título');
  const narrative = (req.body.narrative || '').trim();
  const theme = cleanTheme(req.body.theme);
  if (!ids.length) return res.redirect(`/families/${req.family.id}/workshop/${req.params.aid}/edit`);
  await db.query('UPDATE albums SET title=$1, narrative=$2, theme=$3, memory_ids=$4 WHERE id=$5 AND family_id=$6',
    [title, narrative, theme, JSON.stringify(ids), req.params.aid, req.family.id]);
  req.session.flash = req.t('album_updated');
  res.redirect(`/families/${req.family.id}/workshop/${req.params.aid}`);
});

router.get('/:aid', async (req, res) => {
  const { rows } = await db.query(
    'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
    [req.params.aid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const album = rows[0];
  const ids = Array.isArray(album.memory_ids) ? album.memory_ids : [];
  let memories = [];
  if (ids.length) {
    const { rows: m } = await db.query('SELECT * FROM memories WHERE id = ANY($1)', [ids]);
    const byId = new Map(m.map((x) => [x.id, x]));
    memories = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  res.render('view-layout', {
    page: 'view-album-show', title: album.title,
    family: req.family, membership: req.membership, album, memories,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

router.get('/:aid/download', async (req, res) => {
  const { rows } = await db.query(
    'SELECT a.*, u.name AS author_name FROM albums a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1 AND a.family_id=$2',
    [req.params.aid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const album = rows[0];
  const ids = Array.isArray(album.memory_ids) ? album.memory_ids : [];
  let memories = [];
  if (ids.length) {
    const { rows: m } = await db.query('SELECT * FROM memories WHERE id = ANY($1)', [ids]);
    const byId = new Map(m.map((x) => [x.id, x]));
    memories = ids.map((id) => byId.get(id)).filter(Boolean);
    await withPeople(memories);
  }
  const pdf = await generateAlbumPDF({ family: req.family, album, memories, lang: req.lang });
  const fname = album.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'album';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
  res.send(pdf);
});

router.post('/:aid/delete', canWrite, async (req, res) => {
  await db.query('DELETE FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
  req.session.flash = req.t('album_deleted');
  res.redirect(`/families/${req.family.id}/workshop`);
});

module.exports = router;

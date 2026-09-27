'use strict';
const express = require('express');
const db = require('./db');
const { canWrite, requireAdmin } = require('./mw');
const { generateAlbumPDF } = require('./pdfgen');

const router = express.Router({ mergeParams: true });

async function withPeople(rows) {
  for (const m of rows) {
    const { rows: p } = await db.query(
      'SELECT p.name FROM persons p JOIN memory_people mp ON mp.person_id=p.id WHERE mp.memory_id=$1 ORDER BY p.name', [m.id]);
    m.people_names = p.map((x) => x.name).join(', ');
  }
  return rows;
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
  const { rows } = await db.query(
    "SELECT * FROM memories WHERE family_id=$1 AND status='complete' ORDER BY memory_date NULLS LAST, created_at",
    [req.family.id]);
  const { rows: pers } = await db.query('SELECT id, name FROM persons WHERE family_id=$1 ORDER BY name', [req.family.id]);
  const persById = new Map(pers.map((p) => [p.id, p.name]));
  const { rows: mp } = await db.query(
    'SELECT mp.memory_id, mp.person_id FROM memory_people mp JOIN memories m ON m.id=mp.memory_id WHERE m.family_id=$1',
    [req.family.id]);
  const byMem = {};
  for (const r of mp) { (byMem[r.memory_id] = byMem[r.memory_id] || []).push(r.person_id); }
  for (const m of rows) {
    const pids = byMem[m.id] || [];
    m.people_ids = pids;
    m.people_names = pids.map((id) => persById.get(id)).filter(Boolean).join(', ');
  }
  res.render('view-layout', {
    page: 'view-album-new', title: req.t('new_album'),
    family: req.family, membership: req.membership, memories: rows, persons: pers,
  });
});

router.post('/', canWrite, async (req, res) => {
  let ids = req.body.memory_ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map((x) => parseInt(x, 10)).filter(Boolean);
  const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled album' : 'Álbum sin título');
  const narrative = (req.body.narrative || '').trim();
  if (!ids.length) return res.redirect(`/families/${req.family.id}/workshop/new`);
  // Se valida que los recuerdos pertenezcan a la familia, pero se respeta el orden
  // elegido por el usuario en la lista (puede arrastrar para ordenar).
  const { rows } = await db.query('SELECT id FROM memories WHERE family_id=$1 AND id = ANY($2)', [req.family.id, ids]);
  const okIds = new Set(rows.map((r) => r.id));
  ids = ids.filter((id) => okIds.has(id));
  if (!ids.length) return res.redirect(`/families/${req.family.id}/workshop/new`);
  const { rows: ins } = await db.query(
    'INSERT INTO albums (family_id, title, narrative, memory_ids, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.family.id, title, narrative, JSON.stringify(ids), req.session.user.id]
  );
  req.session.flash = req.t('album_created');
  res.redirect(`/families/${req.family.id}/workshop/${ins[0].id}`);
});

router.get('/:aid', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
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
  const { rows } = await db.query('SELECT * FROM albums WHERE id=$1 AND family_id=$2', [req.params.aid, req.family.id]);
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

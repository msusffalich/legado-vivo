'use strict';
const express = require('express');
const db = require('./db');
const { canWrite } = require('./mw');
const { generateStory, aiEnabled } = require('./ai');

const router = express.Router({ mergeParams: true });

async function withPeople(rows) {
  for (const m of rows) {
    const { rows: p } = await db.query(
      'SELECT p.name FROM persons p JOIN memory_people mp ON mp.person_id=p.id WHERE mp.memory_id=$1 ORDER BY p.name', [m.id]);
    m.people_names = p.map((x) => x.name).join(', ');
  }
  return rows;
}

function memIds(body) {
  let ids = body.memory_ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  return ids.map((x) => parseInt(x, 10)).filter(Boolean);
}

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, u.name AS author FROM stories s LEFT JOIN users u ON u.id = s.created_by
     WHERE s.family_id=$1 ORDER BY s.created_at DESC`, [req.family.id]);
  res.render('view-layout', {
    page: 'view-stories', title: req.t('stories'),
    family: req.family, membership: req.membership, stories: rows,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

// Paso 1: elegir recuerdos base
router.get('/new', canWrite, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM memories WHERE family_id=$1 ORDER BY memory_date NULLS LAST', [req.family.id]);
  res.render('view-layout', {
    page: 'view-story-new', title: req.t('new_story'),
    family: req.family, membership: req.membership, memories: rows,
    ai: aiEnabled(), generated: null, title: '', content: '', selected: [],
  });
});

// Paso 2: generar con IA (o mostrar aviso y permitir manual)
router.post('/generate', canWrite, async (req, res) => {
  const ids = memIds(req.body);
  const { rows } = await db.query('SELECT * FROM memories WHERE family_id=$1 AND id = ANY($2)', [req.family.id, ids]);
  if (!rows.length) return res.redirect(`/families/${req.family.id}/stories/new`);
  await withPeople(rows);
  let generated = null;
  if (aiEnabled()) generated = await generateStory(rows, req.lang);
  res.render('view-layout', {
    page: 'view-story-new', title: req.t('new_story'),
    family: req.family, membership: req.membership, memories: [],
    ai: aiEnabled(), generated, title: '', content: generated || '', selected: ids,
  });
});

// Paso 3: guardar
router.post('/', canWrite, async (req, res) => {
  const ids = memIds(req.body);
  const title = (req.body.title || '').trim() || (req.lang === 'en' ? 'Untitled story' : 'Historia sin título');
  const content = (req.body.content || '').trim();
  if (!content) return res.redirect(`/families/${req.family.id}/stories/new`);
  const { rows: mems } = await db.query('SELECT id, title FROM memories WHERE family_id=$1 AND id = ANY($2)', [req.family.id, ids]);
  const sources = mems.map((m) => ({ id: m.id, title: m.title }));
  const { rows } = await db.query(
    'INSERT INTO stories (family_id, title, content, sources, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.family.id, title, content, JSON.stringify(sources), req.session.user.id]
  );
  req.session.flash = req.t('story_created');
  res.redirect(`/families/${req.family.id}/stories/${rows[0].id}`);
});

router.get('/:sid', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, u.name AS author FROM stories s LEFT JOIN users u ON u.id = s.created_by
     WHERE s.id=$1 AND s.family_id=$2`, [req.params.sid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  res.render('view-layout', {
    page: 'view-story-show', title: rows[0].title,
    family: req.family, membership: req.membership, story: rows[0],
  });
});

module.exports = router;

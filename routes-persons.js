'use strict';
const express = require('express');
const db = require('./db');
const { loadFamily, canWrite } = require('./mw');

const router = express.Router({ mergeParams: true });

// Todas las rutas cuelgan de /families/:fid/persons
router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM persons WHERE family_id=$1 ORDER BY name', [req.family.id]);
  const { rows: memCounts } = await db.query(
    'SELECT person_id, count(*) AS n FROM memory_people mp JOIN memories m ON m.id = mp.memory_id WHERE m.family_id=$1 GROUP BY person_id',
    [req.family.id]
  );
  const counts = Object.fromEntries(memCounts.map((r) => [r.person_id, r.n]));
  res.render('view-layout', {
    page: 'view-persons', title: req.t('persons'),
    family: req.family, membership: req.membership, persons: rows, counts,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

router.post('/', canWrite, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect(`/families/${req.family.id}/persons`);
  await db.query(
    'INSERT INTO persons (family_id, name, relationship, notes, created_by) VALUES ($1,$2,$3,$4,$5)',
    [req.family.id, name, (req.body.relationship || '').trim(), (req.body.notes || '').trim(), req.session.user.id]
  );
  req.session.flash = req.t('person_created');
  res.redirect(`/families/${req.family.id}/persons`);
});

router.post('/:pid', canWrite, async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect(`/families/${req.family.id}/persons`);
  await db.query(
    'UPDATE persons SET name=$1, relationship=$2, notes=$3 WHERE id=$4 AND family_id=$5',
    [name, (req.body.relationship || '').trim(), (req.body.notes || '').trim(), pid, req.family.id]
  );
  req.session.flash = req.t('person_updated');
  res.redirect(`/families/${req.family.id}/persons`);
});

router.post('/:pid/delete', canWrite, async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  const { rows } = await db.query('SELECT * FROM persons WHERE id=$1 AND family_id=$2', [pid, req.family.id]);
  if (!rows.length) return res.redirect(`/families/${req.family.id}/persons`);
  if ((req.body.confirmName || '').trim() !== rows[0].name) {
    req.session.flash = req.t('name_mismatch');
    return res.redirect(`/families/${req.family.id}/persons`);
  }
  await db.query('DELETE FROM persons WHERE id=$1', [pid]);
  req.session.flash = req.t('person_deleted');
  res.redirect(`/families/${req.family.id}/persons`);
});

module.exports = router;

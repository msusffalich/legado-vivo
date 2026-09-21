'use strict';
const express = require('express');
const db = require('./db');
const { conversationalSearch, aiEnabled } = require('./ai');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const chat = req.query.chat === '1';
  let memories = [], persons = [], stories = [], answer = null;
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const { rows: m } = await db.query(
      `SELECT * FROM memories WHERE family_id=$1 AND
       (title ILIKE $2 OR story ILIKE $2 OR transcription ILIKE $2 OR place ILIKE $2
        OR EXISTS (SELECT 1 FROM memory_people mp JOIN persons p ON p.id = mp.person_id
                   WHERE mp.memory_id = memories.id AND p.name ILIKE $2))
       ORDER BY created_at DESC LIMIT 50`, [req.family.id, like]);
    memories = m;
    const { rows: p } = await db.query(
      'SELECT * FROM persons WHERE family_id=$1 AND (name ILIKE $2 OR relationship ILIKE $2 OR notes ILIKE $2) ORDER BY name LIMIT 50',
      [req.family.id, like]);
    persons = p;
    const { rows: s } = await db.query(
      'SELECT * FROM stories WHERE family_id=$1 AND (title ILIKE $2 OR content ILIKE $2) ORDER BY created_at DESC LIMIT 50',
      [req.family.id, like]);
    stories = s;
    if (chat && aiEnabled() && memories.length) {
      for (const mem of memories) {
        const { rows: pp } = await db.query(
          'SELECT p.name FROM persons p JOIN memory_people mp ON mp.person_id=p.id WHERE mp.memory_id=$1 ORDER BY p.name', [mem.id]);
        mem.people_names = pp.map((x) => x.name).join(', ');
      }
      answer = await conversationalSearch(q, memories.slice(0, 12), req.lang);
    }
  }
  res.render('view-layout', {
    page: 'view-search', title: req.t('search'),
    family: req.family, membership: req.membership,
    q, chat, memories, persons, stories, answer, ai: aiEnabled(),
  });
});

module.exports = router;

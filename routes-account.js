'use strict';
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./mw');
const { pickLang } = require('./i18n');

const router = express.Router();

router.get('/account', requireAuth, (req, res) => {
  res.render('view-layout', { page: 'view-account', title: req.t('account_title'), msg: null, error: null });
});

router.post('/account', requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const lang = pickLang(req.body.lang);
  if (!name) {
    return res.render('view-layout', { page: 'view-account', title: req.t('account_title'), msg: null, error: req.t('fill_all') });
  }
  await db.query('UPDATE users SET name=$1, lang=$2 WHERE id=$3', [name, lang, req.session.user.id]);
  req.session.user.name = name;
  req.session.user.lang = lang;
  res.render('view-layout', { page: 'view-account', title: req.t('account_title'), msg: req.t('profile_updated'), error: null });
});

router.post('/account/delete', requireAuth, async (req, res) => {
  const typed = (req.body.confirmName || '').trim();
  if (typed !== req.session.user.name) {
    return res.render('view-layout', { page: 'view-account', title: req.t('account_title'), msg: null, error: req.t('name_mismatch') });
  }
  const uid = req.session.user.id;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Familias donde es el único miembro: se eliminan con todo su contenido
    // (si no, quedarían huérfanas e inaccesibles para siempre).
    const { rows: sole } = await client.query(
      `SELECT f.id FROM families f
       JOIN memberships m ON m.family_id = f.id AND m.user_id = $1
       WHERE NOT EXISTS (SELECT 1 FROM memberships o WHERE o.family_id = f.id AND o.user_id <> $1)`,
      [uid]);
    for (const f of sole) {
      await client.query('DELETE FROM families WHERE id=$1', [f.id]);
    }
    // Si queda como único admin de alguna familia, promueve al miembro más antiguo
    const { rows: fams } = await client.query(
      `SELECT f.id FROM families f
       JOIN memberships m ON m.family_id = f.id AND m.user_id = $1 AND m.role = 'admin'`, [uid]);
    for (const f of fams) {
      const { rows: others } = await client.query(
        `SELECT user_id FROM memberships WHERE family_id = $1 AND user_id <> $2 AND role = 'admin'`, [f.id, uid]);
      if (!others.length) {
        await client.query(
          `UPDATE memberships SET role = 'admin' WHERE id = (
             SELECT id FROM memberships WHERE family_id = $1 AND user_id <> $2 ORDER BY joined_at ASC LIMIT 1)`,
          [f.id, uid]);
      }
    }
    await client.query('DELETE FROM memberships WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM users WHERE id = $1', [uid]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  req.session.destroy(() => res.redirect('/?deleted=1'));
});

module.exports = router;

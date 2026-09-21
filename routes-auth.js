'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAuth } = require('./mw');
const { pickLang } = require('./i18n');

const router = express.Router();

function setUser(req, row) {
  req.session.user = { id: row.id, name: row.name, email: row.email, lang: pickLang(row.lang) };
}

function afterAuthRedirect(req, res, fallback) {
  const pending = req.session.pendingInvite;
  if (pending) {
    delete req.session.pendingInvite;
    return res.redirect('/join?code=' + encodeURIComponent(pending));
  }
  const next = req.query.next || req.body.next;
  if (next && next.startsWith('/') && !next.startsWith('//')) return res.redirect(next);
  res.redirect(fallback);
}

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('view-layout', { page: 'view-register', title: req.t('register_title'), error: null, next: req.query.next || '' });
});

router.post('/register', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const fail = (msg) => res.render('view-layout', { page: 'view-register', title: req.t('register_title'), error: msg, next: req.body.next || '' });
  if (!name || !email || !password) return fail(req.t('fill_all'));
  if (password.length < 6) return fail(req.t('password_min'));
  try {
    const hash = await bcrypt.hash(password, 10);
    const lang = pickLang(req.body.lang || req.lang);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, lang) VALUES ($1,$2,$3,$4) RETURNING id, name, email, lang',
      [name, email, hash, lang]
    );
    setUser(req, rows[0]);
    req.session.flash = req.t('welcome', { name });
    afterAuthRedirect(req, res, '/dashboard');
  } catch (err) {
    if (err.code === '23505') return fail(req.t('email_taken'));
    throw err;
  }
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('view-layout', { page: 'view-login', title: req.t('login_title'), error: null, next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const fail = () => res.render('view-layout', { page: 'view-login', title: req.t('login_title'), error: req.t('auth_error'), next: req.body.next || '' });
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
  if (!rows.length) return fail();
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return fail();
  setUser(req, rows[0]);
  req.session.flash = req.t('welcome', { name: rows[0].name });
  afterAuthRedirect(req, res, '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;

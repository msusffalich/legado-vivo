'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { requireAuth, loadFamily, requireAdmin } = require('./mw');

const router = express.Router();
// Nota: /join es público (el invitado aún no tiene cuenta). El resto requiere sesión.

// ---- Panel: mis familias ----
router.get('/dashboard', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT f.*, m.role, (SELECT count(*) FROM memberships WHERE family_id = f.id) AS members
     FROM families f JOIN memberships m ON m.family_id = f.id
     WHERE m.user_id = $1 ORDER BY f.created_at DESC`,
    [req.session.user.id]
  );
  res.render('view-layout', { page: 'view-dashboard', title: req.t('dashboard_title'), families: rows });
});

// ---- Crear familia ----
router.get('/families/new', requireAuth, (req, res) => {
  res.render('view-layout', { page: 'view-family-new', title: req.t('new_family_title') });
});

router.post('/families', requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  if (!name) return res.redirect('/families/new');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO families (name, description, created_by) VALUES ($1,$2,$3) RETURNING id',
      [name, description, req.session.user.id]
    );
    await client.query(
      "INSERT INTO memberships (family_id, user_id, role) VALUES ($1,$2,'admin')",
      [rows[0].id, req.session.user.id]
    );
    await client.query('COMMIT');
    req.session.flash = req.t('family_created');
    res.redirect('/families/' + rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ---- Ver familia (portada con pestañas) ----
router.get('/families/:fid', requireAuth, loadFamily, async (req, res) => {
  const { rows: members } = await db.query(
    'SELECT m.*, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = $1 ORDER BY m.joined_at',
    [req.family.id]
  );
  const { rows: recent } = await db.query(
    'SELECT * FROM memories WHERE family_id = $1 ORDER BY created_at DESC LIMIT 6',
    [req.family.id]
  );
  res.render('view-layout', {
    page: 'view-family', title: req.family.name,
    family: req.family, membership: req.membership, members, recent, tab: req.query.tab || 'memories',
  });
});

// ---- Ajustes (admin) ----
router.post('/families/:fid', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  if (name) await db.query('UPDATE families SET name=$1, description=$2 WHERE id=$3', [name, description, req.family.id]);
  req.session.flash = req.t('changes_saved');
  res.redirect('/families/' + req.family.id);
});

router.post('/families/:fid/delete', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const typed = (req.body.confirmName || '').trim();
  if (typed !== req.family.name) {
    req.session.flash = req.t('name_mismatch');
    return res.redirect('/families/' + req.family.id + '?tab=settings');
  }
  await db.query('DELETE FROM families WHERE id = $1', [req.family.id]);
  res.redirect('/dashboard');
});

// ---- Miembros (admin) ----
router.post('/families/:fid/members/:mid/role', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const role = req.body.role;
  if (!['admin', 'collaborator', 'reader'].includes(role)) return res.redirect('/families/' + req.family.id);
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memberships WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.redirect('/families/' + req.family.id);
  // No degradar al último admin
  if (rows[0].role === 'admin' && role !== 'admin') {
    const { rows: admins } = await db.query(
      "SELECT id FROM memberships WHERE family_id=$1 AND role='admin' AND id<>$2",
      [req.family.id, mid]
    );
    if (!admins.length) {
      req.session.flash = req.t('cannot_remove_last_admin');
      return res.redirect('/families/' + req.family.id + '?tab=members');
    }
  }
  await db.query('UPDATE memberships SET role=$1 WHERE id=$2', [role, mid]);
  req.session.flash = req.t('role_updated');
  res.redirect('/families/' + req.family.id + '?tab=members');
});

router.post('/families/:fid/members/:mid/remove', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memberships WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.redirect('/families/' + req.family.id);
  if (rows[0].role === 'admin') {
    const { rows: admins } = await db.query(
      "SELECT id FROM memberships WHERE family_id=$1 AND role='admin' AND id<>$2",
      [req.family.id, mid]
    );
    if (!admins.length) {
      req.session.flash = req.t('cannot_remove_last_admin');
      return res.redirect('/families/' + req.family.id + '?tab=members');
    }
  }
  await db.query('DELETE FROM memberships WHERE id=$1', [mid]);
  req.session.flash = req.t('member_removed');
  res.redirect('/families/' + req.family.id + '?tab=members');
});

// ---- Invitaciones ----
function inviteStatus(inv) {
  if (inv.revoked) return 'revoked';
  if (inv.consumed) return 'used';
  if (new Date(inv.expires_at) < new Date()) return 'expired';
  return 'active';
}

function buildWaMessage(req, family, inviterName, invite) {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const expires = new Date(invite.expires_at).toLocaleDateString(req.lang === 'en' ? 'en-US' : 'es-ES');
  const roleWord = req.t(invite.role === 'reader' ? 'role_word_reader' : 'role_word_collaborator');
  const assistantNumber = (process.env.ASSISTANT_WHATSAPP_NUMBER || '').trim();
  return req.t('wa_template', {
    inviter: inviterName, family: family.name, appUrl, code: invite.code, role: roleWord, expires,
    assistantLine: assistantNumber ? req.t('wa_assistant_line', { assistantNumber }) : '',
  });
}

router.get('/families/:fid/invites', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const { rows } = await db.query(
    'SELECT i.*, u.name AS inviter_name FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.family_id=$1 ORDER BY i.created_at DESC',
    [req.family.id]
  );
  const invites = rows.map((r) => ({ ...r, status: inviteStatus(r) }));
  const last = invites[0] && inviteStatus(invites[0]) === 'active' ? invites[0] : null;
  res.render('view-layout', {
    page: 'view-invites', title: req.t('invites'),
    family: req.family, membership: req.membership, invites,
    waMessage: last ? buildWaMessage(req, req.family, req.session.user.name, last) : null,
    waCode: last ? last.code : null,
  });
});

router.post('/families/:fid/invites', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  const role = req.body.role === 'reader' ? 'reader' : 'collaborator';
  const code = 'LV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.query(
    'INSERT INTO invites (family_id, code, role, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [req.family.id, code, role, req.session.user.id, expires]
  );
  req.session.flash = req.t('invite_created');
  res.redirect('/families/' + req.family.id + '/invites');
});

router.post('/families/:fid/invites/:iid/revoke', requireAuth, loadFamily, requireAdmin, async (req, res) => {
  await db.query('UPDATE invites SET revoked = TRUE WHERE id=$1 AND family_id=$2', [req.params.iid, req.family.id]);
  req.session.flash = req.t('invite_revoked');
  res.redirect('/families/' + req.family.id + '/invites');
});

// ---- Unirse con código ----
async function findInvite(code) {
  const { rows } = await db.query(
    `SELECT i.*, f.name AS family_name FROM invites i JOIN families f ON f.id = i.family_id
     WHERE i.code = $1`, [(code || '').trim().toUpperCase()]
  );
  return rows[0] || null;
}

router.get('/join', async (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  let invite = null, error = null;
  if (code) {
    invite = await findInvite(code);
    if (!invite) error = req.t('code_invalid');
    else if (inviteStatus(invite) !== 'active') {
      error = req.t('code_' + inviteStatus(invite));
      invite = null;
    }
  }
  res.render('view-layout', {
    page: 'view-join', title: req.t('join_title'), code, invite, error,
    loggedIn: !!req.session.user,
  });
});

router.post('/join/accept', requireAuth, async (req, res) => {
  const invite = await findInvite(req.body.code);
  const back = '/join?code=' + encodeURIComponent(req.body.code || '');
  if (!invite || inviteStatus(invite) !== 'active') return res.redirect(back);
  const { rows: existing } = await db.query(
    'SELECT id FROM memberships WHERE family_id=$1 AND user_id=$2', [invite.family_id, req.session.user.id]
  );
  if (existing.length) {
    req.session.flash = req.t('already_member');
    return res.redirect('/families/' + invite.family_id);
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO memberships (family_id, user_id, role) VALUES ($1,$2,$3)',
      [invite.family_id, req.session.user.id, invite.role]
    );
    await client.query('UPDATE invites SET consumed = TRUE WHERE id=$1', [invite.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  req.session.flash = req.t('invite_accepted', { family: invite.family_name });
  res.redirect('/families/' + invite.family_id);
});

// Recordar un código pendiente cuando el invitado aún no tiene cuenta
router.post('/join/remember', (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (code) req.session.pendingInvite = code;
  res.redirect('/register?next=' + encodeURIComponent('/join?code=' + code));
});

module.exports = router;

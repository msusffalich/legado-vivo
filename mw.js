'use strict';
// Middlewares de autenticación y permisos.
const db = require('./db');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    const nextUrl = encodeURIComponent(req.originalUrl);
    return res.redirect('/login?next=' + nextUrl);
  }
  next();
}

// Carga la familia :fid y verifica membresía. Requiere requireAuth antes.
async function loadFamily(req, res, next) {
  const fid = parseInt(req.params.fid, 10);
  if (!fid) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const { rows: frows } = await db.query('SELECT * FROM families WHERE id = $1', [fid]);
  if (!frows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const { rows: mrows } = await db.query(
    'SELECT m.*, u.name AS user_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = $1 AND m.user_id = $2',
    [fid, req.session.user.id]
  );
  if (!mrows.length) return res.status(403).render('view-layout', { page: 'view-error', title: '403', message: req.t('forbidden') });
  req.family = frows[0];
  req.membership = mrows[0];
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.membership || !roles.includes(req.membership.role)) {
      return res.status(403).render('view-layout', { page: 'view-error', title: '403', message: req.t('forbidden') });
    }
    next();
  };
}

const requireAdmin = requireRole('admin');
const canWrite = requireRole('admin', 'collaborator');

module.exports = { requireAuth, loadFamily, requireRole, requireAdmin, canWrite };

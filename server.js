'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { runMigrations } = require('./migrate');
const { t, pickLang } = require('./i18n');
const { requireAuth, loadFamily } = require('./mw');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[fatal] Falta DATABASE_URL en el entorno.');
    process.exit(1);
  }
  await runMigrations();

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', __dirname); // ZIP plano: las vistas view-*.ejs están en la raíz

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '30mb' }));
  // Cabeceras seguras. CSP queda desactivada por ahora porque algunas vistas
  // heredadas todavía usan manejadores inline (onclick/onchange).
  app.use(helmet({ contentSecurityPolicy: false }));

   app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET || 'dev-secret-cambialo',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 3600 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  }));
  if (!process.env.SESSION_SECRET) console.warn('[aviso] SESSION_SECRET no configurado; usando valor de desarrollo.');

  // i18n + contexto común para las vistas
  app.use((req, res, next) => {
    const lang = pickLang((req.session.user && req.session.user.lang) || req.session.lang || 'es');
    req.lang = lang;
    req.t = (k, vars) => t(lang, k, vars);
    res.locals.t = req.t;
    res.locals.lang = lang;
    res.locals.user = req.session.user || null;
    // flash de una sola lectura (vive en la sesión para sobrevivir redirects)
    if (req.session && req.session.flash) { res.locals.flash = req.session.flash; delete req.session.flash; }
    else res.locals.flash = null;
    res.locals.appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const locale = lang === 'en' ? 'en-US' : 'es-ES';
    res.locals.fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    res.locals.fmtDateTime = (iso) => iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    res.locals.fmtMemDate = (m) => {
      const iso = res.locals.memDateISO(m);
      if (!iso) return t(lang, 'no_date');
      const s = new Date(iso + 'T12:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
      return m.date_precision === 'approx' ? (lang === 'en' ? 'c. ' : 'aprox. ') + s : s;
    };
    // Normaliza DATE de Postgres (Date) o string a 'AAAA-MM-DD'
    res.locals.memDateISO = (m) => {
      const d = m && m.memory_date;
      if (!d) return '';
      if (d instanceof Date) return isNaN(d) ? '' : d.toISOString().slice(0, 10);
      return String(d).slice(0, 10);
    };
    res.locals.roleName = (r) => t(lang, r === 'admin' ? 'admin' : r === 'reader' ? 'reader' : 'collaborator');
    next();
  });

  // Selector de idioma (público: funciona con o sin sesión)
  app.post('/lang', (req, res) => {
    const lang = pickLang(req.body.lang);
    req.session.lang = lang;
    if (req.session.user) {
      req.session.user.lang = lang;
      db.query('UPDATE users SET lang=$1 WHERE id=$2', [lang, req.session.user.id]).catch(() => {});
    }
    res.redirect(req.get('referer') || '/');
  });

  // Archivos públicos y subidas
  app.get('/assets/style.css', (req, res) => res.sendFile(path.join(__dirname, 'assets-style.css')));
  app.get('/assets/app.js', (req, res) => res.sendFile(path.join(__dirname, 'assets-app.js')));
  // Subidas protegidas: solo un miembro de la familia del recuerdo puede ver sus fotos/audios
  app.get('/uploads/:name', requireAuth, async (req, res) => {
    const name = path.basename(req.params.name || '');
    if (!name) return res.status(404).send('No encontrado');
    const rel = '/uploads/' + name;
    const { rows } = await db.query(
      'SELECT family_id FROM memories WHERE photo_path=$1 OR audio_path=$1 LIMIT 1', [rel]);
    if (!rows.length) return res.status(404).send('No encontrado');
    const { rows: ok } = await db.query(
      'SELECT 1 FROM memberships WHERE family_id=$1 AND user_id=$2',
      [rows[0].family_id, req.session.user.id]);
    if (!ok.length) return res.status(403).send('Sin permiso');
    res.sendFile(path.join(UPLOAD_DIR, name), { maxAge: '7d' }, (err) => {
      if (err && !res.headersSent) res.status(404).send('No encontrado');
    });
  });

  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, database: 'ok', time: new Date().toISOString() });
    } catch (err) {
      console.error('[healthz] base de datos no disponible:', err.message);
      res.status(503).json({ ok: false, database: 'unavailable', time: new Date().toISOString() });
    }
  });

  // Portada
  app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('view-layout', { page: 'view-home', title: req.t('app_name'), deleted: req.query.deleted === '1' });
  });

  app.get('/help', (req, res) => {
    res.render('view-layout', { page: 'view-help', title: req.t('help_title') });
  });

  // Rutas
  app.use('/', require('./routes-auth'));
  app.use('/', require('./routes-account'));
  app.use('/', require('./routes-families'));
  app.use('/api/bridge', require('./routes-bridge'));

  // Rutas anidadas bajo familia (requieren membresía)
  app.use('/families/:fid/persons', requireAuth, loadFamily, require('./routes-persons'));
  app.use('/families/:fid/memories', requireAuth, loadFamily, require('./routes-memories'));
  app.use('/families/:fid/stories', requireAuth, loadFamily, require('./routes-stories'));
  app.use('/families/:fid/workshop', requireAuth, loadFamily, require('./routes-workshop'));
  app.use('/families/:fid/search', requireAuth, loadFamily, require('./routes-search'));

  // 404
  app.use((req, res) => {
    res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  });

  // Errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).render('view-layout', { page: 'view-error', title: 'Error', message: req.t ? req.t('error_generic') : 'Error' });
  });

  const port = parseInt(process.env.PORT, 10) || 3000;
  app.listen(port, () => {
    console.log(`[legado-vivo] escuchando en puerto ${port} · lang por defecto es`);
    console.log(`[legado-vivo] APP_URL=${process.env.APP_URL || '(no configurado)'}`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});

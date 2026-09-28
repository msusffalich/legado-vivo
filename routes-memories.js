'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { loadFamily, canWrite } = require('./mw');
const { ensureVideoThumb, deleteVideoThumb } = require('./video-thumb');
const { isSupportedVideoUrl, downloadVideoUrl, isSupportedImageUrl, downloadImageUrl, downloadInstagramImage } = require('./media-download');

const router = express.Router({ mergeParams: true });

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const VIDEO_MAX_MB = 200; // límite para video
const MEDIA_MAX_MB = 100; // límite para foto y audio
// Formatos aceptados por extensión (además del MIME que reporta el navegador,
// que a veces viene vacío o genérico según el dispositivo).
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff',
  'heic', 'heif', 'avif', 'svg', 'ico', 'dng', 'cr2', 'nef', 'arw', 'rw2', 'orf', 'pef', 'srw', 'psd']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv',
  '3gp', '3g2', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'wma',
  'opus', 'aiff', 'aif', 'amr', '3ga']);
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT]);
const upload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mimeOk = /^(image|audio|video)\//.test(file.mimetype || '');
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
    const ok = mimeOk || MEDIA_EXT.has(ext);
    cb(ok ? null : new Error('badtype'), ok);
  },
});
const fields = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]);

function isXhr(req) {
  return req.get('x-requested-with') === 'XMLHttpRequest' ||
    String(req.get('accept') || '').includes('application/json');
}

function cleanupUploads(files) {
  if (!files) return;
  for (const arr of Object.values(files)) {
    for (const f of arr || []) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch (e) { /* noop */ }
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename + '.thumb.jpg')); } catch (e) { /* noop */ }
    }
  }
}

// Revisa que foto/audio no pasen de 100 MB (el video ya está limitado a 200 MB por multer).
function checkMediaSizes(req) {
  for (const name of ['photo', 'audio']) {
    const f = req.files && req.files[name] && req.files[name][0];
    if (f && f.size > MEDIA_MAX_MB * 1024 * 1024) return new Error('toobig:' + name);
  }
  return null;
}

// Responde el motivo de la falla: JSON para subida con progreso (XHR), flash+redirect para POST clásico.
function uploadFail(req, res, err, fallback) {
  let msg;
  if (err && err.code === 'LIMIT_FILE_SIZE') msg = req.t('upload_too_large_generic');
  else if (err && /^toobig:/.test(err.message || '')) msg = req.t('upload_too_large', { max: MEDIA_MAX_MB });
  else if (err && err.message === 'badtype') msg = req.t('upload_bad_type');
  else msg = req.t('error_generic');
  cleanupUploads(req.files);
  if (isXhr(req)) return res.status(400).json({ ok: false, error: msg });
  req.session.flash = msg;
  return res.redirect(fallback);
}

async function peopleNames(familyId, memoryId) {
  const { rows } = await db.query(
    'SELECT p.name FROM persons p JOIN memory_people mp ON mp.person_id = p.id WHERE mp.memory_id=$1 ORDER BY p.name',
    [memoryId]
  );
  return rows.map((r) => r.name).join(', ');
}

async function withPeople(rows) {
  for (const r of rows) r.people_names = await peopleNames(null, r.id);
  return rows;
}

function personIds(body) {
  let ids = body.person_ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  return ids.map((x) => parseInt(x, 10)).filter(Boolean);
}

// Descarga en segundo plano el video de una URL y lo adjunta al recuerdo.
// No bloquea la respuesta: el recuerdo queda con video_dl_status='pending'
// hasta que termina ('ready') o falla ('error', con el motivo en video_dl_error).
function queueVideoDownload(memoryId, url) {
  if (!url || !isSupportedVideoUrl(url)) return;
  (async () => {
    const fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4';
    const dest = path.join(UPLOAD_DIR, fname);
    const r = await downloadVideoUrl(url, dest);
    if (r.ok) {
      await db.query(
        `UPDATE memories SET video_path=$1, video_dl_status='ready', video_dl_error=NULL, updated_at=now() WHERE id=$2`,
        ['/uploads/' + fname, memoryId]
      );
      ensureVideoThumb(dest);
    } else {
      try { fs.unlinkSync(dest); } catch (e) { /* noop */ }
      await db.query(
        `UPDATE memories SET video_dl_status='error', video_dl_error=$1, updated_at=now() WHERE id=$2`,
        [String(r.error || 'download-failed').slice(0, 500), memoryId]
      );
    }
  })().catch((e) => console.error('[video-url]', e.message));
}

// Descarga en segundo plano la foto de una URL y la adjunta al recuerdo.
// Los posts de Instagram (/p/, /reel/) se resuelven con yt-dlp; las URLs
// directas de imagen se descargan por HTTP (content-type image/*).
function queueImageDownload(memoryId, url) {
  if (!url || !isSupportedImageUrl(url)) return;
  (async () => {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const r = host === 'instagram.com'
      ? await downloadInstagramImage(url, UPLOAD_DIR)
      : await downloadImageUrl(url, UPLOAD_DIR);
    if (r.ok) {
      await db.query(
        `UPDATE memories SET photo_path=$1, photo_dl_status='ready', photo_dl_error=NULL, updated_at=now() WHERE id=$2`,
        ['/uploads/' + r.filename, memoryId]
      );
    } else {
      await db.query(
        `UPDATE memories SET photo_dl_status='error', photo_dl_error=$1, updated_at=now() WHERE id=$2`,
        [String(r.error || 'download-failed').slice(0, 500), memoryId]
      );
    }
  })().catch((e) => console.error('[photo-url]', e.message));
}

// Valida la URL de video del formulario; responde 400 si el host no es válido.
function checkVideoUrl(req, res, fallback) {
  const url = (req.body.video_url || '').trim();
  if (url && !isSupportedVideoUrl(url)) {
    const msg = req.t('video_url_invalid');
    cleanupUploads(req.files);
    if (isXhr(req)) { res.status(400).json({ ok: false, error: msg }); return true; }
    req.session.flash = msg;
    res.redirect(fallback);
    return true;
  }
  return false;
}

// Valida la URL de foto del formulario; responde 400 si no es válida.
function checkPhotoUrl(req, res, fallback) {
  const url = (req.body.photo_url || '').trim();
  if (url && !isSupportedImageUrl(url)) {
    const msg = req.t('photo_url_invalid');
    cleanupUploads(req.files);
    if (isXhr(req)) { res.status(400).json({ ok: false, error: msg }); return true; }
    req.session.flash = msg;
    res.redirect(fallback);
    return true;
  }
  return false;
}

// ---- Lista ----
router.get('/', async (req, res) => {
  const status = req.query.status === 'pending' ? 'pending' : null;
  let sql = 'SELECT * FROM memories WHERE family_id=$1';
  const params = [req.family.id];
  if (status) { sql += ' AND status=$2'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await db.query(sql, params);
  await withPeople(rows);
  res.render('view-layout', {
    page: 'view-memories', title: req.t('memories'),
    family: req.family, membership: req.membership, memories: rows, statusFilter: status,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

// ---- Nuevo ----
router.get('/new', canWrite, async (req, res) => {
  const { rows: persons } = await db.query('SELECT * FROM persons WHERE family_id=$1 ORDER BY name', [req.family.id]);
  res.render('view-layout', {
    page: 'view-memory-new', title: req.t('new_memory'),
    family: req.family, membership: req.membership, persons,
  });
});

router.post('/', canWrite, (req, res, next) => {
  fields(req, res, (err) => {
    if (err) return uploadFail(req, res, err, `/families/${req.family.id}/memories/new`);
    const sizeErr = checkMediaSizes(req);
    if (sizeErr) return uploadFail(req, res, sizeErr, `/families/${req.family.id}/memories/new`);
    if (checkVideoUrl(req, res, `/families/${req.family.id}/memories/new`)) return;
    if (checkPhotoUrl(req, res, `/families/${req.family.id}/memories/new`)) return;
    next();
  });
}, async (req, res, next) => {
  try {
  const b = req.body;
  const title = (b.title || '').trim() || (req.lang === 'en' ? 'Untitled memory' : 'Recuerdo sin título');
  const interview = {};
  for (const k of ['see', 'who', 'where', 'when', 'remember']) {
    if (b['iq_' + k]) interview[k] = b['iq_' + k];
  }
  const photo = req.files && req.files.photo ? '/uploads/' + req.files.photo[0].filename : null;
  const audio = req.files && req.files.audio ? '/uploads/' + req.files.audio[0].filename : null;
  const video = req.files && req.files.video ? '/uploads/' + req.files.video[0].filename : null;
  const videoUrl = (b.video_url || '').trim() || null;
  const photoUrl = (b.photo_url || '').trim() || null;
  const memoryDate = (b.memory_date || '').trim() || null;
  const { rows } = await db.query(
    `INSERT INTO memories (family_id, title, story, transcription, place, memory_date, date_precision,
      photo_path, audio_path, video_path, video_url, video_dl_status,
      photo_url, photo_dl_status, interview, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'complete',$16) RETURNING id`,
    [req.family.id, title, b.story || '', b.transcription || '', (b.place || '').trim(), memoryDate,
     ['exact', 'approx'].includes(b.date_precision) ? b.date_precision : 'unknown',
     photo, audio, video, videoUrl, videoUrl && !video ? 'pending' : 'ready',
     photoUrl, photoUrl && !photo ? 'pending' : 'ready',
     JSON.stringify(interview), req.session.user.id]
  );
  const mid = rows[0].id;
  for (const pid of personIds(b)) {
    await db.query('INSERT INTO memory_people (memory_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mid, pid]);
  }
  const doneCreateUrl = `/families/${req.family.id}/memories/${mid}`;
  // Miniatura del video en segundo plano (no bloquea la respuesta).
  if (video) ensureVideoThumb(path.join(UPLOAD_DIR, path.basename(video)));
  // Video/foto por URL: se descargan en segundo plano y se adjuntan al terminar.
  if (videoUrl && !video) queueVideoDownload(mid, videoUrl);
  if (photoUrl && !photo) queueImageDownload(mid, photoUrl);
  if (isXhr(req)) return res.json({ ok: true, redirect: doneCreateUrl });
  req.session.flash = req.t('memory_created');
  res.redirect(doneCreateUrl);
  } catch (e) {
    cleanupUploads(req.files);
    if (isXhr(req)) return res.status(500).json({ ok: false, error: req.t('upload_server_error') });
    return next(e);
  }
});

// ---- Ver ----
router.get('/:mid', async (req, res) => {
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memories WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const m = rows[0];
  m.people_names = await peopleNames(null, m.id);
  const { rows: ppl } = await db.query(
    'SELECT p.* FROM persons p JOIN memory_people mp ON mp.person_id=p.id WHERE mp.memory_id=$1 ORDER BY p.name', [mid]);
  const { rows: author } = await db.query('SELECT name FROM users WHERE id=$1', [m.created_by]);
  const { rows: versions } = await db.query('SELECT * FROM memory_versions WHERE memory_id=$1 ORDER BY created_at DESC', [mid]);
  res.render('view-layout', {
    page: 'view-memory-show', title: m.title,
    family: req.family, membership: req.membership, memory: m, persons: ppl,
    author: author[0] ? author[0].name : null, versions,
    canWrite: ['admin', 'collaborator'].includes(req.membership.role),
  });
});

// ---- Editar (guarda versión anterior) ----
router.get('/:mid/edit', canWrite, async (req, res) => {
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memories WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const { rows: persons } = await db.query('SELECT * FROM persons WHERE family_id=$1 ORDER BY name', [req.family.id]);
  const { rows: linked } = await db.query('SELECT person_id FROM memory_people WHERE memory_id=$1', [mid]);
  res.render('view-layout', {
    page: 'view-memory-edit', title: req.t('edit_memory'),
    family: req.family, membership: req.membership, memory: rows[0], persons,
    linked: linked.map((r) => r.person_id),
  });
});

router.post('/:mid', canWrite, (req, res, next) => {
  fields(req, res, (err) => {
    if (err) return uploadFail(req, res, err, `/families/${req.family.id}/memories/${req.params.mid}/edit`);
    const sizeErr = checkMediaSizes(req);
    if (sizeErr) return uploadFail(req, res, sizeErr, `/families/${req.family.id}/memories/${req.params.mid}/edit`);
    if (checkVideoUrl(req, res, `/families/${req.family.id}/memories/${req.params.mid}/edit`)) return;
    if (checkPhotoUrl(req, res, `/families/${req.family.id}/memories/${req.params.mid}/edit`)) return;
    next();
  });
}, async (req, res, next) => {
  try {
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memories WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const old = rows[0];
  const b = req.body;
  // Instantánea de la versión anterior
  await db.query('INSERT INTO memory_versions (memory_id, data, created_by) VALUES ($1,$2,$3)',
    [mid, JSON.stringify(old), req.session.user.id]);
  const interview = {};
  for (const k of ['see', 'who', 'where', 'when', 'remember']) {
    if (b['iq_' + k]) interview[k] = b['iq_' + k];
  }
  const photo = req.files && req.files.photo ? '/uploads/' + req.files.photo[0].filename : old.photo_path;
  const audio = req.files && req.files.audio ? '/uploads/' + req.files.audio[0].filename : old.audio_path;
  const video = req.files && req.files.video ? '/uploads/' + req.files.video[0].filename : old.video_path;
  const videoUrl = (b.video_url || '').trim() || null;
  const photoUrl = (b.photo_url || '').trim() || null;
  const urlChanged = videoUrl !== (old.video_url || null);
  const photoUrlChanged = photoUrl !== (old.photo_url || null);
  const dlStatus = video ? 'ready' : (videoUrl && urlChanged ? 'pending' : (old.video_dl_status || 'ready'));
  const photoDlStatus = photo ? 'ready' : (photoUrl && photoUrlChanged ? 'pending' : (old.photo_dl_status || 'ready'));
  const title = (b.title || '').trim() || old.title;
  await db.query(
    `UPDATE memories SET title=$1, story=$2, transcription=$3, place=$4, memory_date=$5, date_precision=$6,
      photo_path=$7, audio_path=$8, video_path=$9, video_url=$10, video_dl_status=$11,
      video_dl_error=CASE WHEN $11='pending' THEN NULL ELSE video_dl_error END,
      photo_url=$12, photo_dl_status=$13,
      photo_dl_error=CASE WHEN $13='pending' THEN NULL ELSE photo_dl_error END,
      interview=$14, status=$15, updated_at=now() WHERE id=$16`,
    [title, b.story || '', b.transcription || '', (b.place || '').trim(), (b.memory_date || '').trim() || null,
     ['exact', 'approx', 'unknown'].includes(b.date_precision) ? b.date_precision : 'unknown',
     photo, audio, video, videoUrl, dlStatus, photoUrl, photoDlStatus,
     JSON.stringify(interview), b.status === 'pending' ? 'pending' : 'complete', mid]
  );
  await db.query('DELETE FROM memory_people WHERE memory_id=$1', [mid]);
  for (const pid of personIds(b)) {
    await db.query('INSERT INTO memory_people (memory_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mid, pid]);
  }
  const doneEditUrl = `/families/${req.family.id}/memories/${mid}`;
  // Si se reemplazó el video, regenerar su miniatura en segundo plano.
  if (req.files && req.files.video) {
    if (old.video_path && old.video_path !== video) {
      deleteVideoThumb(path.join(UPLOAD_DIR, path.basename(old.video_path)));
    }
    ensureVideoThumb(path.join(UPLOAD_DIR, path.basename(video)));
  }
  // Nueva URL de video: descargar en segundo plano.
  if (videoUrl && urlChanged && !req.files.video) queueVideoDownload(mid, videoUrl);
  // Nueva URL de foto: descargar en segundo plano.
  if (photoUrl && photoUrlChanged && !req.files.photo) queueImageDownload(mid, photoUrl);
  if (isXhr(req)) return res.json({ ok: true, redirect: doneEditUrl });
  req.session.flash = req.t('memory_updated');
  res.redirect(doneEditUrl);
  } catch (e) {
    cleanupUploads(req.files);
    if (isXhr(req)) return res.status(500).json({ ok: false, error: req.t('upload_server_error') });
    return next(e);
  }
});

router.post('/:mid/delete', canWrite, async (req, res) => {
  const mid = parseInt(req.params.mid, 10);
  const r = await db.query('DELETE FROM memories WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  req.session.flash = req.t(r.rowCount ? 'memory_deleted' : 'not_found');
  res.redirect(`/families/${req.family.id}/memories`);
});

// ---- Cronología ----
router.get('/timeline/view', async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM memories WHERE family_id=$1 ORDER BY memory_date NULLS LAST, created_at`,
    [req.family.id]
  );
  await withPeople(rows);
  res.render('view-layout', {
    page: 'view-timeline', title: req.t('timeline_title'),
    family: req.family, membership: req.membership, memories: rows,
  });
});

module.exports = router;
// Para reanudar descargas pendientes al arrancar (server.js).
module.exports.queueVideoDownload = queueVideoDownload;
module.exports.queueImageDownload = queueImageDownload;

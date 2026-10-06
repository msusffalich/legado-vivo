'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { loadFamily, canWrite } = require('./mw');
const { normalizeMedia, normalizeUploads, mediaErrorMessage } = require('./media-normalize');
const { ensureVideoThumb, deleteVideoThumb } = require('./video-thumb');
const { extractDocText } = require('./doc-extract');
const { aiEnabled, generateMemoryComment } = require('./ai');
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
  'heic', 'heif', 'hif', 'avif', 'svg', 'ico', 'dng', 'cr2', 'cr3', 'crw', 'raf', 'raw', 'nef', 'arw', 'rw2', 'orf', 'pef', 'srw', 'psd']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv',
  '3gp', '3g2', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'wma',
  'opus', 'aiff', 'aif', 'amr', '3ga']);
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT]);
// Documentos adjuntos con narrativa extraída (PDF, Word, texto plano).
const DOC_EXT = new Set(['pdf', 'docx', 'txt', 'md', 'markdown']);
const DOC_MAX_MB = 20; // límite para documentos
const upload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mimeOk = /^(image|audio|video)\//.test(file.mimetype || '');
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
    const accepted = file.fieldname === 'photo' ? IMAGE_EXT : file.fieldname === 'video' ? VIDEO_EXT : file.fieldname === 'audio' ? AUDIO_EXT : DOC_EXT;
    const expected = file.fieldname === 'photo' ? 'image/' : file.fieldname === 'video' ? 'video/' : file.fieldname === 'audio' ? 'audio/' : null;
    const ok = accepted.has(ext) || (expected && (file.mimetype || '').startsWith(expected));
    cb(ok ? null : new Error('badtype'), ok);
  },
});
const fields = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

function isXhr(req) {
  return req.get('x-requested-with') === 'XMLHttpRequest' ||
    String(req.get('accept') || '').includes('application/json');
}

function cleanupUploads(files) {
  if (!files) return;
  for (const arr of Object.values(files)) {
    for (const f of arr || []) {
      if (f.sourceFilename && !f.preserveSource) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.sourceFilename)); } catch (_) {} }
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch (e) { /* noop */ }
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename + '.thumb.jpg')); } catch (e) { /* noop */ }
    }
  }
}

// Procesa el documento adjunto: extrae su texto como narrativa del recuerdo.
// Devuelve { docPath, docName, docText } o null si no se subió documento.
async function processDocumentUpload(req) {
  const f = req.files && req.files.document && req.files.document[0];
  if (!f) return null;
  const abs = path.join(UPLOAD_DIR, f.filename);
  const r = await extractDocText(abs, f.originalname || f.filename);
  return {
    docPath: '/uploads/' + f.filename,
    docName: f.originalname || f.filename,
    docText: r.ok ? (r.text || '') : '',
  };
}

// Genera el comentario opcional de la IA (solo si la casilla está marcada
// y hay clave de OpenAI). Devuelve el texto o ''.
async function maybeAiComment(req, info) {
  if (req.body.ai_comment_gen !== '1' || !aiEnabled()) return '';
  try {
    const c = await generateMemoryComment(info, req.lang || 'es');
    return c || '';
  } catch (e) {
    console.error('[ai-comment]', e.message);
    return '';
  }
}

// Borra el archivo de un documento reemplazado o eliminado.
function deleteDocFile(docPath) {
  if (!docPath) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(docPath))); } catch (e) { /* noop */ }
}

// Revisa que foto/audio no pasen de 100 MB (el video ya está limitado a 200 MB por multer)
// y que el documento no pase de DOC_MAX_MB.
function checkMediaSizes(req) {
  for (const name of ['photo', 'audio']) {
    const f = req.files && req.files[name] && req.files[name][0];
    if (f && f.size > MEDIA_MAX_MB * 1024 * 1024) return new Error('toobig:' + name);
  }
  const d = req.files && req.files.document && req.files.document[0];
  if (d && d.size > DOC_MAX_MB * 1024 * 1024) return new Error('toobig:document');
  return null;
}

// Responde el motivo de la falla: JSON para subida con progreso (XHR), flash+redirect para POST clásico.
function uploadFail(req, res, err, fallback) {
  let msg;
  if (err && /^MEDIA_/.test(err.code || '')) msg = mediaErrorMessage(err, req.lang);
  else if (err && err.code === 'LIMIT_FILE_SIZE') msg = req.t('upload_too_large_generic');
  else if (err && /^toobig:/.test(err.message || '')) {
    const max = /toobig:document/.test(err.message) ? DOC_MAX_MB : MEDIA_MAX_MB;
    msg = req.t('upload_too_large', { max });
  }
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
async function attachDownloadedMedia(memoryId, url, kind, download) {
  let source, converted;
  const column = kind === 'photo' ? 'photo' : 'video';
  try {
    const result = await download();
    if (!result.ok) throw new Error(result.error || 'download-failed');
    source = path.join(UPLOAD_DIR, result.filename);
    converted = await normalizeMedia(source, kind);
    const r = await db.query(
      `UPDATE memories SET ${column}_path=$1, ${column}_dl_status='ready', ${column}_dl_error=NULL, updated_at=now() WHERE id=$2 AND ${column}_url=$3 AND ${column}_dl_status='pending'`,
      ['/uploads/' + converted.filename, memoryId, url]);
    if (!r.rowCount) {
      await fs.promises.rm(converted.path, { force: true });
      await fs.promises.rm(source, { force: true });
    } else if (kind === 'video') ensureVideoThumb(converted.path);
  } catch (e) {
    if (converted) await fs.promises.rm(converted.path, { force: true }).catch(() => {});
    if (source) await fs.promises.rm(source, { force: true }).catch(() => {});
    await db.query(
      `UPDATE memories SET ${column}_dl_status='error', ${column}_dl_error=$1, updated_at=now() WHERE id=$2 AND ${column}_url=$3 AND ${column}_dl_status='pending'`,
      [/^MEDIA_/.test(e.code || '') ? mediaErrorMessage(e, 'es') : String(e.message).slice(0, 500), memoryId, url]);
  }
}
function queueVideoDownload(memoryId, url) {
  if (!url || !isSupportedVideoUrl(url)) return;
  attachDownloadedMedia(memoryId, url, 'video', async () => {
    const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4';
    const dest = path.join(UPLOAD_DIR, filename);
    const r = await downloadVideoUrl(url, dest);
    if (!r.ok) await fs.promises.rm(dest, { force: true }).catch(() => {});
    return { ...r, filename };
  }).catch(e => console.error('[video-url]', e.message));
}
function queueImageDownload(memoryId, url) {
  if (!url || !isSupportedImageUrl(url)) return;
  attachDownloadedMedia(memoryId, url, 'photo', () => {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'instagram.com' ? downloadInstagramImage(url, UPLOAD_DIR) : downloadImageUrl(url, UPLOAD_DIR);
  }).catch(e => console.error('[photo-url]', e.message));
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
    aiEnabled: aiEnabled(),
  });
});

router.post('/', canWrite, (req, res, next) => {
  fields(req, res, async (err) => {
    if (err) return uploadFail(req, res, err, `/families/${req.family.id}/memories/new`);
    const sizeErr = checkMediaSizes(req);
    if (sizeErr) return uploadFail(req, res, sizeErr, `/families/${req.family.id}/memories/new`);
    if (checkVideoUrl(req, res, `/families/${req.family.id}/memories/new`)) return;
    if (checkPhotoUrl(req, res, `/families/${req.family.id}/memories/new`)) return;
    try { await normalizeUploads(req.files, UPLOAD_DIR); }
    catch (conversionError) { return uploadFail(req, res, conversionError, `/families/${req.family.id}/memories/${req.params.mid ? req.params.mid + '/edit' : 'new'}`); }
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
  const doc = await processDocumentUpload(req);
  const storyForAi = (b.story || '') + (doc && doc.docText ? '\n\n' + doc.docText.slice(0, 2000) : '');
  const aiComment = await maybeAiComment(req, {
    title, story: storyForAi, transcription: b.transcription || '',
    photo_path: photo, video_path: video,
  });
  const { rows } = await db.query(
    `INSERT INTO memories (family_id, title, story, transcription, place, memory_date, date_precision,
      photo_path, audio_path, video_path, video_url, video_dl_status,
      photo_url, photo_dl_status, interview, status, created_by,
      doc_path, doc_name, doc_text, ai_comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'complete',$16,$17,$18,$19,$20) RETURNING id`,
    [req.family.id, title, b.story || '', b.transcription || '', (b.place || '').trim(), memoryDate,
     ['exact', 'approx'].includes(b.date_precision) ? b.date_precision : 'unknown',
     photo, audio, video, videoUrl, videoUrl && !video ? 'pending' : 'ready',
     photoUrl, photoUrl && !photo ? 'pending' : 'ready',
     JSON.stringify(interview), req.session.user.id,
     doc ? doc.docPath : null, doc ? doc.docName : null, doc ? doc.docText : '', aiComment]
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
    aiEnabled: aiEnabled(),
  });
});

router.post('/:mid', canWrite, (req, res, next) => {
  fields(req, res, async (err) => {
    if (err) return uploadFail(req, res, err, `/families/${req.family.id}/memories/${req.params.mid}/edit`);
    const sizeErr = checkMediaSizes(req);
    if (sizeErr) return uploadFail(req, res, sizeErr, `/families/${req.family.id}/memories/${req.params.mid}/edit`);
    if (checkVideoUrl(req, res, `/families/${req.family.id}/memories/${req.params.mid}/edit`)) return;
    if (checkPhotoUrl(req, res, `/families/${req.family.id}/memories/${req.params.mid}/edit`)) return;
    try { await normalizeUploads(req.files, UPLOAD_DIR); }
    catch (conversionError) { return uploadFail(req, res, conversionError, `/families/${req.family.id}/memories/${req.params.mid ? req.params.mid + '/edit' : 'new'}`); }
    next();
  });
}, async (req, res, next) => {
  try {
  const mid = parseInt(req.params.mid, 10);
  const { rows } = await db.query('SELECT * FROM memories WHERE id=$1 AND family_id=$2', [mid, req.family.id]);
  if (!rows.length) return res.status(404).render('view-layout', { page: 'view-error', title: '404', message: req.t('not_found') });
  const old = rows[0];
  const uploadedKinds = new Set(Object.keys(req.files || {}));
  // Saving an existing memory repairs legacy, unconverted media too.
  try {
    req.files = req.files || {};
    for (const kind of ['photo', 'video', 'audio']) {
      const stored = old[kind + '_path'];
      const suffix = kind === 'photo' ? '.view.jpg' : kind === 'video' ? '.view.mp4' : '.view.mp3';
      if (req.files[kind] || !stored || stored.endsWith(suffix)) continue;
      const source = path.join(UPLOAD_DIR, path.basename(stored));
      const converted = await normalizeMedia(source, kind);
      req.files[kind] = [{ ...converted, preserveSource: true }];
    }
  } catch (e) {
    return uploadFail(req, res, e, `/families/${req.family.id}/memories/${mid}/edit`);
  }
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
  // Documento: reemplazo, eliminación o se conserva el anterior.
  let docPath = old.doc_path, docName = old.doc_name, docText = old.doc_text || '';
  const newDoc = await processDocumentUpload(req);
  if (newDoc) {
    deleteDocFile(old.doc_path);
    docPath = newDoc.docPath; docName = newDoc.docName; docText = newDoc.docText;
  } else if (b.doc_remove === '1' && old.doc_path) {
    deleteDocFile(old.doc_path);
    docPath = null; docName = null; docText = '';
  }
  const storyForAi = (b.story || '') + (docText ? '\n\n' + docText.slice(0, 2000) : '');
  const aiComment = req.body.ai_comment_gen === '1'
    ? (await maybeAiComment(req, {
        title, story: storyForAi, transcription: b.transcription || '',
        photo_path: photo, video_path: video,
      })) || (old.ai_comment || '') // si la IA falla, conserva el comentario anterior
    : (old.ai_comment || '');
  await db.query(
    `UPDATE memories SET title=$1, story=$2, transcription=$3, place=$4, memory_date=$5, date_precision=$6,
      photo_path=$7, audio_path=$8, video_path=$9, video_url=$10, video_dl_status=$11,
      video_dl_error=CASE WHEN $11='pending' THEN NULL ELSE video_dl_error END,
      photo_url=$12, photo_dl_status=$13,
      photo_dl_error=CASE WHEN $13='pending' THEN NULL ELSE photo_dl_error END,
      interview=$14, status=$15, updated_at=now(),
      doc_path=$17, doc_name=$18, doc_text=$19, ai_comment=$20 WHERE id=$16`,
    [title, b.story || '', b.transcription || '', (b.place || '').trim(), (b.memory_date || '').trim() || null,
     ['exact', 'approx', 'unknown'].includes(b.date_precision) ? b.date_precision : 'unknown',
     photo, audio, video, videoUrl, dlStatus, photoUrl, photoDlStatus,
     JSON.stringify(interview), b.status === 'pending' ? 'pending' : 'complete', mid,
     docPath, docName, docText, aiComment]
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
  if (videoUrl && urlChanged && !uploadedKinds.has('video')) queueVideoDownload(mid, videoUrl);
  // Nueva URL de foto: descargar en segundo plano.
  if (photoUrl && photoUrlChanged && !uploadedKinds.has('photo')) queueImageDownload(mid, photoUrl);
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


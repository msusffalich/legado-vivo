'use strict';
// Convert before a path is written to the database. Keep the source file intact.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let active = false;
const waiting = [];
function failure(code) { const e = new Error(code); e.code = code; return e; }
function acquire() {
  if (!active) { active = true; return Promise.resolve(); }
  if (waiting.length >= 3) return Promise.reject(failure('MEDIA_BUSY'));
  return new Promise((resolve, reject) => {
    const item = { resolve, timer: null };
    item.timer = setTimeout(() => {
      const i = waiting.indexOf(item); if (i !== -1) waiting.splice(i, 1);
      reject(failure('MEDIA_BUSY'));
    }, 30000);
    waiting.push(item);
  });
}
function release() {
  const next = waiting.shift();
  if (next) { clearTimeout(next.timer); next.resolve(); }
  else active = false;
}
function run(bin, args, output, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let detail = '', forced = null;
    const kill = code => {
      forced = code;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (_) {}
    };
    const timer = setTimeout(() => kill('MEDIA_TIMEOUT'), 180000);
    const check = setInterval(() => {
      try { if (fs.statSync(output).size > maxBytes) kill('MEDIA_TOO_LARGE'); } catch (_) {}
    }, 500);
    child.stderr.on('data', b => { detail = (detail + b.toString()).slice(-1500); });
    child.once('error', e => { clearTimeout(timer); clearInterval(check); reject(failure(e.code === 'ENOENT' ? 'MEDIA_ENGINE_MISSING' : 'MEDIA_CONVERSION_FAILED')); });
    child.once('close', code => {
      clearTimeout(timer); clearInterval(check);
      if (forced || code !== 0) {
        console.error('[media-convert]', forced || code, detail);
        reject(failure(forced || 'MEDIA_CONVERSION_FAILED'));
      } else resolve();
    });
  });
}
async function normalizeMedia(source, kind) {
  if (!['photo', 'video', 'audio'].includes(kind)) throw failure('MEDIA_CONVERSION_FAILED');
  source = path.resolve(source);
  const ext = kind === 'photo' ? '.jpg' : kind === 'video' ? '.mp4' : '.mp3';
  const output = source + '.view' + ext;
  // Explicit format means the temporary suffix cannot affect encoding.
  const temp = output + '.partial';
  await acquire();
  try {
    const maxBytes = (kind === 'video' ? 300 : 100) * 1024 * 1024;
    if (kind === 'photo') {
      await run(process.execPath, ['--max-old-space-size=512', path.join(__dirname, 'media-photo-worker.js'), source, temp], temp, maxBytes);
    } else {
      const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-threads', '2', '-i', source];
      if (kind === 'video') args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf',
        "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2',
        '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', '-f', 'mp4');
      else args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', '-map_metadata', '-1', '-f', 'mp3');
      args.push(temp);
      await run(ffmpeg, args, temp, maxBytes);
    }
    const size = (await fs.promises.stat(temp)).size;
    if (!size) throw failure('MEDIA_CONVERSION_FAILED');
    if (size > maxBytes) throw failure('MEDIA_TOO_LARGE');
    await fs.promises.rename(temp, output);
    return { filename: path.basename(output), path: output, size, sourceFilename: path.basename(source) };
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    // dcraw's intermediate is never the user's source.
    await fs.promises.rm(temp + '.tiff', { force: true }).catch(() => {});
    release();
  }
}
async function normalizeUploads(files, directory) {
  for (const kind of ['photo', 'video', 'audio']) {
    const f = files && files[kind] && files[kind][0];
    if (!f) continue;
    const converted = await normalizeMedia(path.join(directory, f.filename), kind);
    Object.assign(f, converted);
    f.mimetype = kind === 'photo' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/mpeg';
  }
}
function mediaErrorMessage(err, lang) {
  const en = lang === 'en';
  if (err.code === 'MEDIA_BUSY') return en ? 'Other files are being converted. Your form is unchanged; please retry shortly.' : 'Se están convirtiendo otros archivos. Tu formulario se conserva; vuelve a intentarlo en unos momentos.';
  if (err.code === 'MEDIA_TIMEOUT') return en ? 'Conversion took too long. Try a shorter video or a smaller file. Your form is unchanged.' : 'La conversión tardó demasiado. Prueba con un video más corto o un archivo menor. Tu formulario se conserva.';
  if (err.code === 'MEDIA_TOO_LARGE') return en ? 'The converted file exceeds the size limit. Try a smaller file.' : 'El archivo convertido supera el límite de tamaño. Prueba con un archivo menor.';
  if (err.code === 'MEDIA_ENGINE_MISSING') return en ? 'The server media converter is unavailable. Please contact the administrator.' : 'El conversor de archivos no está disponible en el servidor. Contacta al administrador.';
  return en ? 'This file could not be converted. It may be damaged, protected, or use an unsupported codec. Your form is unchanged; try another file.' : 'No se pudo convertir este archivo. Puede estar dañado, protegido o usar una variante no compatible. Tu formulario se conserva; prueba con otro archivo.';
}
module.exports = { normalizeMedia, normalizeUploads, mediaErrorMessage };

'use strict';
// Descarga de medios desde URL con yt-dlp o HTTP directo.
//
// Videos: solo YouTube / Instagram (lista blanca anti-SSRF), vía yt-dlp,
//   mp4 hasta 720p y tope de 200 MB (igual que la subida de video).
// Fotos: cualquier URL http(s) cuya respuesta sea una imagen (content-type
//   image/*), tope de 100 MB (igual que la subida de foto). Se bloquean
//   hosts privados/de red local por nombre.
//
// El nombre del archivo destino lo genera el servidor; la URL del usuario
// jamás toca el sistema de archivos.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'instagram.com', 'www.instagram.com',
]);

// Nombres de host que nunca se descargan por HTTP directo (red local/privada).
const BLOCKED_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?|\[?fe80)/i;

const VIDEO_MAX_MB = 200;
const PHOTO_MAX_MB = 100;
const DL_TIMEOUT_MS = 8 * 60 * 1000;

function isSupportedVideoUrl(raw) {
  if (!raw) return false;
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  return ALLOWED_VIDEO_HOSTS.has(u.hostname.toLowerCase());
}

function isSupportedImageUrl(raw) {
  if (!raw) return false;
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(host)) return false;
  return true;
}

// Ruta al binario yt-dlp que trae el paquete youtube-dl-exec.
function ytdlpBin() {
  try {
    const pkgDir = path.dirname(require.resolve('youtube-dl-exec/package.json'));
    const bin = path.join(pkgDir, 'bin', 'yt-dlp');
    if (fs.existsSync(bin)) return bin;
    const exe = bin + '.exe';
    if (fs.existsSync(exe)) return exe;
  } catch (e) { /* no instalado */ }
  return null;
}

// Descarga video (YouTube/Instagram) a destAbs (debe terminar en .mp4).
// Resuelve { ok:true } o { ok:false, error }.
function downloadVideoUrl(url, destAbs) {
  return new Promise((resolve) => {
    if (!isSupportedVideoUrl(url)) {
      return resolve({ ok: false, error: 'unsupported-url' });
    }
    const bin = ytdlpBin();
    if (!bin) {
      return resolve({ ok: false, error: 'yt-dlp no disponible en el servidor' });
    }
    try { fs.mkdirSync(path.dirname(destAbs), { recursive: true }); } catch (e) { /* noop */ }
    const args = [
      '--no-playlist',
      '--max-filesize', VIDEO_MAX_MB + 'M',
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b',
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '--no-progress',
      '-o', destAbs,
      String(url).trim(),
    ];
    execFile(bin, args, { timeout: DL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String((stderr || '') + ' ' + (err.message || '')).trim().slice(0, 300);
        return resolve({ ok: false, error: msg || 'download-failed' });
      }
      try {
        const st = fs.statSync(destAbs);
        if (!st.size) { fs.unlinkSync(destAbs); return resolve({ ok: false, error: 'empty-file' }); }
      } catch (e) {
        return resolve({ ok: false, error: 'download-failed' });
      }
      resolve({ ok: true });
    });
  });
}

const IMAGE_EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/bmp': '.bmp', 'image/tiff': '.tif', 'image/svg+xml': '.svg', 'image/avif': '.avif',
  'image/x-icon': '.ico', 'image/heic': '.heic', 'image/heif': '.heif',
};

// Descarga una imagen por HTTP directo a destDir (genera el nombre con la
// extensión según el content-type). Resuelve { ok:true, filename } o { ok:false, error }.
async function downloadImageUrl(url, destDir) {
  if (!isSupportedImageUrl(url)) return { ok: false, error: 'unsupported-url' };
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DL_TIMEOUT_MS);
    res = await fetch(String(url).trim(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'LegadoVivo/1.0 (family archive)' },
    });
    clearTimeout(timer);
  } catch (e) {
    return { ok: false, error: 'fetch-failed' };
  }
  if (!res.ok) return { ok: false, error: 'http-' + res.status };
  const ctype = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_EXT_BY_TYPE[ctype];
  if (!ext) return { ok: false, error: 'not-an-image' };
  const maxBytes = PHOTO_MAX_MB * 1024 * 1024;
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > maxBytes) return { ok: false, error: 'too-large' };
  const fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
  const dest = path.join(destDir, fname);
  try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) { /* noop */ }
  try {
    const fh = fs.openSync(dest, 'w');
    let bytes = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) {
        try { reader.cancel(); } catch (e) { /* noop */ }
        fs.closeSync(fh); fs.unlinkSync(dest);
        return { ok: false, error: 'too-large' };
      }
      fs.writeSync(fh, value);
    }
    fs.closeSync(fh);
    if (!bytes) { fs.unlinkSync(dest); return { ok: false, error: 'empty-file' }; }
    return { ok: true, filename: fname };
  } catch (e) {
    try { fs.unlinkSync(dest); } catch (e2) { /* noop */ }
    return { ok: false, error: 'download-failed' };
  }
}

// Foto de un post de Instagram (instagram.com/p/... o /reel/...) vía yt-dlp.
// Para URLs directas de imagen, usar downloadImageUrl.
function downloadInstagramImage(url, destDir) {
  return new Promise((resolve) => {
    const bin = ytdlpBin();
    if (!bin) return resolve({ ok: false, error: 'yt-dlp no disponible en el servidor' });
    const base = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const tpl = path.join(destDir, base + '.%(ext)s');
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) { /* noop */ }
    execFile(bin, ['--no-playlist', '--no-warnings', '--no-progress', '-o', tpl, String(url).trim()],
      { timeout: DL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err) => {
        if (err) return resolve({ ok: false, error: 'download-failed' });
        try {
          const files = fs.readdirSync(destDir).filter((f) => f.startsWith(base + '.'));
          const img = files.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
          for (const f of files) {
            if (f !== img) { try { fs.unlinkSync(path.join(destDir, f)); } catch (e) { /* noop */ } }
          }
          if (!img) return resolve({ ok: false, error: 'not-an-image' });
          return resolve({ ok: true, filename: img });
        } catch (e) {
          return resolve({ ok: false, error: 'download-failed' });
        }
      });
  });
}

module.exports = {
  isSupportedVideoUrl, downloadVideoUrl,
  isSupportedImageUrl, downloadImageUrl, downloadInstagramImage,
  VIDEO_MAX_MB, PHOTO_MAX_MB,
};

'use strict';
// Portable HTML albums. No remote fetches, extra packages, or database writes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { themeOf } = require('./album-themes');

const escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textBlock = (text) => text ? `<div class="prose">${escapeHtml(text)}</div>` : '';
const WORDS = {
  es: {
    album: 'Álbum multimedia', contents: 'Contenido', narrative: 'Nuestra historia',
    memory: 'Recuerdo', story: 'Historia', photo: 'Foto', video: 'Video', audio: 'Audio',
    document: 'Documento', people: 'Personas', transcript: 'Transcripción',
    documentText: 'Texto del documento', ai: 'Comentario de IA',
    open: 'Abrir archivo', external: 'Abrir enlace original (requiere internet)',
    missing: 'Archivo no disponible en esta copia', notes: 'Archivos y enlaces',
    help: 'Extrae album.html y ábrelo en un navegador. Las fotos, los videos y los audios están incorporados en ese archivo; los documentos adjuntos, si los hay, están en medios.',
    playback: 'Pulsa reproducir para escuchar el audio original del video. Abre este archivo en un navegador, no en una vista previa de documentos.',
    offline: 'Los archivos incluidos se pueden abrir sin conexión. Los enlaces originales necesitan internet.',
    top: 'Volver a la portada', noDate: 'Sin fecha', by: 'Por',
  },
  en: {
    album: 'Multimedia album', contents: 'Contents', narrative: 'Our story',
    memory: 'Memory', story: 'Story', photo: 'Photo', video: 'Video', audio: 'Audio',
    document: 'Document', people: 'People', transcript: 'Transcript',
    documentText: 'Document text', ai: 'AI comment', open: 'Open file',
    external: 'Open original link (internet required)', missing: 'File unavailable in this copy',
    notes: 'Files and links', help: 'Extract album.html and open it in a browser. Photos, videos and audio are embedded in that file; document attachments, if any, are in medios.',
    playback: 'Press play to hear the original video audio. Open this file in a browser, not a document preview.',
    offline: 'Included files work offline. Original links require internet.',
    top: 'Back to cover', noDate: 'No date', by: 'By',
  },
};

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function dateLabel(value, lang, approx) {
  const iso = value instanceof Date ? (isNaN(value) ? '' : value.toISOString().slice(0, 10)) : String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return WORDS[lang].noDate;
  const date = new Date(iso + 'T12:00:00Z');
  if (isNaN(date)) return WORDS[lang].noDate;
  return (approx ? (lang === 'en' ? 'c. ' : 'aprox. ') : '') + date.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-PE', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// Serialize conversion work to avoid exhausting the production server.
let conversionQueue = Promise.resolve();
function convertMedia(source, kind) {
  const task = conversionQueue.catch(() => {}).then(async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'legado-html-'));
    const ext = kind === 'photo' ? '.jpg' : kind === 'audio' ? '.mp3' : '.mp4';
    const output = path.join(dir, 'media' + ext);
    try {
      const binary = process.env.FFMPEG_PATH || require('ffmpeg-static');
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source];
      if (kind === 'photo') args.push('-frames:v', '1', '-vf', 'scale=1920:1920:force_original_aspect_ratio=decrease', '-q:v', '2', '-threads', '1');
      else if (kind === 'audio') args.push('-vn', '-c:a', 'libmp3lame', '-b:a', '160k', '-ac', '2');
      else args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart');
      args.push('-map_metadata', '-1', '-y', output);
      await new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let detail = '';
        child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-1500); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
        child.once('error', err => { clearTimeout(timer); reject(err); });
        child.once('close', code => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else { const err = new Error('Media conversion failed: ' + detail); err.code = 'MEDIA_CONVERSION_FAILED'; reject(err); }
        });
      });
      const info = await fs.promises.stat(output);
      if (info.size > 80 * 1024 * 1024) { const err = new Error('Embedded media too large'); err.code = 'ALBUM_TOO_LARGE'; throw err; }
      return { data: await fs.promises.readFile(output), mime: kind === 'photo' ? 'image/jpeg' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4' };
    } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
  });
  conversionQueue = task.then(() => undefined, () => undefined);
  return task;
}

// Read only basename paths inside UPLOAD_DIR; reject traversal and escaping symlinks.
async function prepareAlbumHTML({ family, album, items, lang = 'es', uploadDir }) {
  lang = lang === 'en' ? 'en' : 'es';
  const w = WORDS[lang], e = escapeHtml;
  let root = null;
  try { root = await fs.promises.realpath(uploadDir || process.env.UPLOAD_DIR || path.join(__dirname, 'uploads')); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  let embeddedBytes = 0;
  const entries = [], copied = new Map(), notes = [], sections = [], toc = [];
  const allowed = new Set(['.jpg','.jpeg','.png','.webp','.gif','.avif','.heic','.mp4','.m4v','.mov','.webm','.ogv','.avi','.mkv','.mp3','.wav','.m4a','.ogg','.oga','.aac','.flac','.pdf','.txt','.md','.docx']);
  async function mediaFile(value, kind) {
    if (!value || !root || typeof value !== 'string' || !/^\/uploads\/[^/\\]+$/.test(value)) return null;
    try {
      const source = await fs.promises.realpath(path.join(root, path.basename(value)));
      const relative = path.relative(root, source);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
      const key = source + ':' + kind;
      if (copied.has(key)) return copied.get(key);
      const stat = await fs.promises.stat(source);
      if (!stat.isFile()) return null;
      await fs.promises.access(source, fs.constants.R_OK);
      if (kind !== 'document') {
        const converted = await convertMedia(source, kind).catch(err => { if (err.code !== 'ALBUM_TOO_LARGE') err.code = 'MEDIA_CONVERSION_FAILED'; throw err; });
        embeddedBytes += converted.data.length;
        if (embeddedBytes > 120 * 1024 * 1024) { const err = new Error('Embedded album too large'); err.code = 'ALBUM_TOO_LARGE'; throw err; }
        const uri = 'data:' + converted.mime + ';base64,' + converted.data.toString('base64');
        copied.set(key, uri);
        return uri;
      }
      const ext = path.extname(source).toLowerCase();
      const name = `medios/archivo-${String(entries.length + 1).padStart(4, '0')}${allowed.has(ext) ? ext : '.bin'}`;
      entries.push({ name, path: source, size: stat.size });
      copied.set(key, name);
      return name;
    } catch (err) {
      if (['ENOENT','EACCES','ENOTDIR','ELOOP'].includes(err.code)) return null;
      throw err;
    }
  }
  let number = 0;
  for (const item of items) {
    const anchor = `bloque-${sections.length + 1}`;
    if (item.kind === 'story') {
      toc.push(`<a href="#${anchor}">${e(item.title || w.story)}</a>`);
      sections.push(`<section class="story panel" id="${anchor}"><p class="eyebrow">${e(w.story)}</p><h2>${e(item.title || w.story)}</h2>${textBlock(item.text)}</section>`);
      continue;
    }
    const m = item.memory;
    // Defense in depth: never package media from another family.
    if (!m || String(m.family_id) !== String(family.id)) continue;
    number++;
    const title = m.title || `${w.memory} ${number}`;
    const media = [];
    const photoPaths = [...new Set([m.photo_path, ...(m.photo_paths || [])].filter(Boolean))];
    const videoPaths = [...new Set([m.video_path, ...(m.video_paths || [])].filter(Boolean))];
    for (const [kind, field, remote] of [
      ['photo','photo_path','photo_url'], ['video','video_path','video_url'],
      ['audio','audio_path',null], ['document','doc_path',null],
    ]) {
      const values = kind === 'photo' ? (photoPaths.length ? photoPaths : [null]) : kind === 'video' ? (videoPaths.length ? videoPaths : [null]) : [m[field]];
      for (const value of values) {
      const src = await mediaFile(value, kind);
      const original = remote ? externalUrl(m[remote]) : '';
      if (src) {
        if (kind === 'photo') media.push(`<figure><img src="${src}" alt="${e(title)}" loading="eager"></figure>`);
        else if (kind === 'video') media.push(`<figure><video controls playsinline preload="metadata" aria-label="${e(title)}" src="${src}"></video><figcaption>${e(w.video)}</figcaption></figure>`);
        else if (kind === 'audio') media.push(`<figure><audio controls preload="metadata" aria-label="${e(title)}" src="${src}"></audio><figcaption>${e(w.audio)}</figcaption></figure>`);
        else media.push(`<p><a class="file-link" href="${src}" download>${e(w.document)}: ${e(m.doc_name || w.open)}</a></p>`);
      } else if (value || (remote && m[remote])) {
        const warning = `${title} — ${w[kind]}: ${w.missing}`;
        notes.push(warning);
        media.push(`<p class="notice">${e(w[kind])}: ${e(w.missing)}.${original ? ` <a href="${e(original)}" target="_blank" rel="noopener noreferrer">${e(w.external)}</a>` : ''}</p>`);
      }
      }
    }
    const meta = [dateLabel(m.memory_date, lang, m.date_precision === 'approx'), m.place].filter(Boolean).join(' · ');
    toc.push(`<a href="#${anchor}">${number}. ${e(title)}</a>`);
    sections.push(`<article class="panel" id="${anchor}"><p class="eyebrow">${e(w.memory)} ${number}</p><h2>${e(title)}</h2><p class="meta">${e(meta)}</p>${m.people_names ? `<p class="meta">${e(w.people)}: ${e(m.people_names)}</p>` : ''}${media.join('\n')}${textBlock(m.story)}${m.transcription ? `<details><summary>${e(w.transcript)}</summary>${textBlock(m.transcription)}</details>` : ''}${m.doc_text ? `<details><summary>${e(w.documentText)}</summary>${textBlock(m.doc_text)}</details>` : ''}${m.ai_comment ? `<aside class="note"><h3>${e(w.ai)}</h3>${textBlock(m.ai_comment)}</aside>` : ''}<a class="back" href="#portada">↑ ${e(w.top)}</a></article>`);
  }
  const theme = themeOf(album.theme);
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${e(album.title)} · Legado Vivo</title>
<style>
:root{--accent:${theme.accent};--soft:${theme.soft};--deep:${theme.deep};color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f5f2ed;color:#2b2925;font:18px/1.7 Georgia,'Times New Roman',serif}a{color:var(--deep);text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:5px}h1,h2,h3{line-height:1.18;overflow-wrap:anywhere}h1{font-size:clamp(2.4rem,7vw,4.8rem);margin:.4em 0}h2{font-size:clamp(1.6rem,4vw,2.5rem);margin:.4em 0}h3{font-size:1.2rem}.cover{min-height:65vh;display:grid;place-content:center;text-align:center;background:var(--soft);color:var(--deep);padding:64px 24px;border-top:10px solid var(--accent);border-bottom:1px solid #d7cbb9}.cover-inner{max-width:900px;margin:auto}.eyebrow{font:700 12px/1.5 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.17em;color:var(--deep)}.meta{font:15px/1.65 system-ui,sans-serif;color:#62594e}.wrapper{width:min(900px,100% - 32px);margin:32px auto}.panel{background:#fff;border:1px solid #e4dccf;border-radius:16px;padding:clamp(20px,5vw,52px);margin:26px 0;box-shadow:0 8px 30px #35200e08}.story{background:var(--soft);border-left:5px solid var(--accent)}.prose{white-space:pre-wrap;overflow-wrap:anywhere;margin:24px 0}.prose:first-letter{font-size:1.35em}.contents{font-family:system-ui,sans-serif}.contents a{display:block;padding:9px 0;border-bottom:1px solid #eee5d9;overflow-wrap:anywhere}figure{margin:28px 0}img,video{display:block;width:100%;max-height:75vh;object-fit:contain;border-radius:10px}video{background:#181818;aspect-ratio:16/9}audio{width:100%}figcaption,.back,.file-link{font:14px/1.7 system-ui,sans-serif}figcaption{padding:8px 0}.notice,.note{padding:18px;border-left:3px solid var(--accent);background:var(--soft);font:15px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}details{margin:20px 0}summary{cursor:pointer;font-family:system-ui,sans-serif}.back{display:inline-block;margin-top:20px}footer{text-align:center;padding:24px;font:14px/1.7 system-ui,sans-serif;color:#62594e}footer p{margin:8px 0}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:#fff}.cover{min-height:0}.panel{break-inside:avoid;box-shadow:none}.contents,.back{display:none}}
</style></head><body>
<header class="cover" id="portada"><div class="cover-inner"><p class="eyebrow">Legado Vivo · ${e(w.album)}</p><p>${e(family.name)}</p><h1>${e(album.title)}</h1>${album.author_name ? `<p>${e(w.by)} ${e(album.author_name)}</p>` : ''}<p class="meta">${e(dateLabel(album.created_at, lang))} · ${number} ${lang === 'en' ? (number === 1 ? 'memory' : 'memories') : (number === 1 ? 'recuerdo' : 'recuerdos')}</p></div></header>
<main class="wrapper">${album.narrative ? `<section class="panel"><p class="eyebrow">${e(w.narrative)}</p>${textBlock(album.narrative)}</section>` : ''}
<nav class="panel contents" aria-label="${e(w.contents)}"><h2>${e(w.contents)}</h2>${toc.join('\n')}</nav>
${sections.join('\n')}
${notes.length ? `<section class="panel"><h2>${e(w.notes)}</h2><ul>${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul></section>` : ''}
</main><footer><strong>Legado Vivo</strong><p>${e(w.help)}</p><p>${e(w.offline)}</p><p>${e(w.playback)}</p></footer></body></html>`;
  const instructions = `${album.title}\n\n${w.help}\n\n${w.offline}\n${w.playback}\n` + (notes.length ? `\n${w.notes}:\n${notes.join('\n')}\n` : '');
  entries.unshift({ name: 'album.html', data: Buffer.from(html, 'utf8') }, { name: 'LEEME-README.txt', data: Buffer.from(instructions, 'utf8') });
  // ZIP32 has a 4 GiB boundary. Fail before sending headers, rather than corrupting a download.
  const size = zipSize(entries);
  return { entries, size, notes };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function zipSize(entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.data ? entry.data.length : entry.size) + 92 + 2 * Buffer.byteLength(entry.name), 22);
  if (entries.length >= 65535 || !Number.isSafeInteger(total) || total >= 0xffffffff) {
    const err = new Error('Album exceeds ZIP32 limit'); err.code = 'ALBUM_TOO_LARGE'; throw err;
  }
  return total;
}

// ZIP STORE + data descriptors: stream videos with bounded memory and backpressure.
// The central directory and CRC32 make the archive readable by standard unzip tools.
async function* albumZip(entries) {
  zipSize(entries);
  let offset = 0;
  const directory = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6); header.writeUInt16LE(33, 12); // UTF-8, descriptor, 1980-01-01
    header.writeUInt16LE(name.length, 26);
    const start = offset;
    yield header; yield name; offset += header.length + name.length;
    let crc = 0xffffffff, bytes = 0;
    const source = entry.data ? [entry.data] : fs.createReadStream(entry.path);
    for await (const chunk of source) {
      for (let i = 0; i < chunk.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]) & 255] ^ (crc >>> 8);
      bytes += chunk.length;
      if (bytes > (entry.data ? entry.data.length : entry.size)) throw new Error('Media changed during export');
      yield chunk; offset += chunk.length;
    }
    if (bytes !== (entry.data ? entry.data.length : entry.size)) throw new Error('Media changed during export');
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(bytes, 8); descriptor.writeUInt32LE(bytes, 12);
    yield descriptor; offset += 16;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0808, 8); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes, 20); central.writeUInt32LE(bytes, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(start, 42);
    directory.push(central, name);
  }
  const centralOffset = offset;
  for (const chunk of directory) { yield chunk; offset += chunk.length; }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralOffset, 12); end.writeUInt32LE(centralOffset, 16);
  yield end;
}

module.exports = { prepareAlbumHTML, albumZip };

'use strict';
// Generación del álbum PDF con maquetación editorial (pdfkit):
// portada temática (título, autor, fecha, motivo decorativo), página de narrativa,
// un recuerdo por página (la imagen nunca se parte ni queda huérfana),
// cabecera con el título del álbum y número de página al pie.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');
const { ensureVideoThumb } = require('./video-thumb');
const { themeOf } = require('./album-themes');

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const INK = '#2b2118';
const MUTED = '#6b5b4c';
const FAINT = '#8a7a68';
const RULE = '#ddd2bf';

function fmtDate(m, lang) {
  const d0 = m.memory_date;
  const iso = d0 instanceof Date ? (isNaN(d0) ? '' : d0.toISOString().slice(0, 10)) : String(d0 || '').slice(0, 10);
  if (!iso) return t(lang, 'no_date');
  const d = new Date(iso + 'T12:00:00');
  const s = d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  if (m.date_precision === 'approx') return (lang === 'en' ? 'c. ' : 'aprox. ') + s;
  return s;
}

function fmtAlbumDate(dt, lang) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Divide un texto en párrafos (doble salto de línea) para maquetarlo con aire.
function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function countText(n, lang) {
  return n === 1 ? t(lang, 'one_memory') : t(lang, 'memories_count', { n });
}

// Los emojis a color no existen en las fuentes estándar del PDF y salen como
// símbolos extraños: se retiran solo del documento (la web los conserva).
function pdfText(s) {
  if (s === null || s === undefined) return s;
  return String(s)
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')   // banderas (indicadores regionales)
    .replace(/\p{Extended_Pictographic}/gu, '') // emojis pictográficos
    .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g, '') // selectores de variante, ZWJ, keycap
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeForPdf(album, items) {
  const a = Object.assign({}, album, { title: pdfText(album.title), narrative: pdfText(album.narrative) });
  const list = (items || []).map((it) => {
    if (it.kind === 'story') {
      return Object.assign({}, it, { title: pdfText(it.title), text: pdfText(it.text) });
    }
    const m = Object.assign({}, it.memory);
    ['title', 'story', 'transcription', 'place', 'people_names', 'doc_name', 'doc_text', 'ai_comment']
      .forEach((k) => { if (m[k]) m[k] = pdfText(m[k]); });
    return Object.assign({}, it, { memory: m });
  });
  return { album: a, items: list };
}

function generateAlbumPDF({ family, album, items, lang }) {
  return (async () => {
    ({ album, items } = sanitizeForPdf(album, items));
    const theme = themeOf(album.theme);
    const doc = new PDFDocument({ margin: 56, size: 'A4', bufferPages: true });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const memories = items.filter((it) => it.kind === 'memory').map((it) => it.memory);
    drawCover(doc, { family, album, memories, lang, theme });

    const narrative = album.narrative && String(album.narrative).trim();
    if (narrative) drawNarrative(doc, { narrative, lang, theme });

    let memIdx = 0;
    for (const it of items) {
      if (it.kind === 'story') {
        drawStoryBlock(doc, { title: it.title, text: it.text, albumTitle: album.title, lang, theme });
      } else {
        memIdx++;
        await drawMemory(doc, { m: it.memory, idx: memIdx, total: memories.length, albumTitle: album.title, lang, theme });
      }
    }

    // Números de página al pie (todas las páginas menos la portada).
    // El pie se escribe dentro del margen inferior: se reduce el margen
    // temporalmente porque pdfkit abre una página nueva si el texto supera maxY().
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(i);
      const pg = doc.page;
      const oldBottom = pg.margins.bottom;
      pg.margins.bottom = 20;
      doc.fontSize(9).fillColor(FAINT).text(
        String(i + 1),
        pg.margins.left,
        pg.height - 38,
        { width: pg.width - pg.margins.left - pg.margins.right, align: 'center' }
      );
      // Rombito temático sobre el número de página
      const dcx = pg.width / 2, dcy = pg.height - 50, ds = 2.6;
      doc.save();
      doc.fillColor(theme.accent).opacity(0.7);
      doc.polygon([dcx, dcy - ds], [dcx + ds, dcy], [dcx, dcy + ds], [dcx - ds, dcy]).fill();
      doc.restore();
      pg.margins.bottom = oldBottom;
    }

    doc.end();
    return done;
  })();
}

// ---- Decoración temática de páginas interiores ----
// Banda superior en el color de la temática (posición fija: no mueve el cursor
// ni abre páginas nuevas).
function drawTopBand(doc, theme) {
  const pg = doc.page;
  doc.save();
  doc.fillColor(theme.accent).opacity(0.9).rect(0, 0, pg.width, 7).fill();
  doc.restore();
}

// Pequeños rombos en las cuatro esquinas, tenue.
function drawCornerMarks(doc, theme) {
  const pg = doc.page;
  const m = 22, s = 3.2;
  doc.save();
  doc.fillColor(theme.accent).opacity(0.35);
  for (const [x, y] of [[m, m + 4], [pg.width - m, m + 4], [m, pg.height - m], [pg.width - m, pg.height - m]]) {
    doc.polygon([x, y - s], [x + s, y], [x, y + s], [x - s, y]).fill();
  }
  doc.restore();
}

// Filete ornamental centrado bajo el título: dos reglas + rombo.
function drawDivider(doc, theme) {
  const pg = doc.page;
  const cx = pg.width / 2;
  const y = doc.y + 2;
  const half = 64, s = 4;
  doc.save();
  doc.strokeColor(theme.accent).lineWidth(0.75).opacity(0.85);
  doc.moveTo(cx - half, y).lineTo(cx - 12, y).stroke();
  doc.moveTo(cx + 12, y).lineTo(cx + half, y).stroke();
  doc.fillColor(theme.accent).opacity(1);
  doc.polygon([cx, y - s], [cx + s, y], [cx, y + s], [cx - s, y]).fill();
  doc.restore();
  doc.y = y + 6;
  doc.moveDown(0.5);
}

// Primer párrafo con inicial grande en el color de la temática.
// Aproximación editorial con pdfkit (inicial en la primera línea).
function drawDropCapParagraph(doc, text, theme, size) {
  const str = String(text || '');
  if (!str) return;
  const first = str[0];
  const rest = str.slice(1);
  doc.fontSize(24).fillColor(theme.accent).text(first, { continued: true });
  doc.fontSize(size).fillColor(INK).text(rest, { align: 'justify', lineGap: 4 });
  doc.moveDown(0.5);
}

// ---- Portada: título, autor, fecha y decorado según la temática ----
function drawCover(doc, { family, album, memories, lang, theme }) {
  const pg = doc.page;
  const W = pg.width, H = pg.height;

  // Fondo suave de la temática
  doc.rect(0, 0, W, H).fill(theme.soft);
  drawMotif(doc, theme, W, H);

  const cx = { align: 'center' };
  doc.y = 250;
  doc.fontSize(12).fillColor(MUTED)
    .text(String(family.name).toUpperCase(), { align: 'center', characterSpacing: 2 });
  doc.moveDown(1);
  const rw = 64, rx = (W - rw) / 2;
  doc.strokeColor(theme.accent).lineWidth(1.5).moveTo(rx, doc.y).lineTo(rx + rw, doc.y).stroke();
  doc.moveDown(1.2);
  doc.fontSize(32).fillColor(theme.deep).text(album.title, cx);
  doc.moveDown(1);
  if (album.author_name) {
    doc.fontSize(13).fillColor(theme.deep).text(t(lang, 'by_author', { name: album.author_name }), cx);
    doc.moveDown(0.4);
  }
  const dateStr = fmtAlbumDate(album.created_at, lang);
  doc.fontSize(12).fillColor(MUTED)
    .text([dateStr, countText(memories.length, lang)].filter(Boolean).join(' · '), cx);

  // Firma al pie de la portada
  doc.fontSize(10).fillColor(FAINT)
    .text(t(lang, 'app_tagline'), pg.margins.left, H - 80, { width: W - pg.margins.left - pg.margins.right, align: 'center' });
}

// Motivo decorativo vectorial según la temática.
function drawMotif(doc, theme, W, H) {
  const A = theme.accent;
  doc.save();
  if (theme.motif === 'frame') {
    doc.opacity(0.7);
    doc.strokeColor(A).lineWidth(1).rect(28, 28, W - 56, H - 56).stroke();
    doc.strokeColor(A).lineWidth(0.5).rect(36, 36, W - 72, H - 72).stroke();
  } else if (theme.motif === 'dots') {
    doc.opacity(0.5);
    const pts = [[80, 90, 7], [115, 72, 4.5], [68, 128, 4], [W - 80, 90, 7], [W - 115, 72, 4.5], [W - 68, 128, 4]];
    for (const [x, y, r] of pts) { doc.fillColor(A).circle(x, y, r).fill(); }
  } else if (theme.motif === 'confetti') {
    const colors = [A, '#e8a13d', '#3d7de8', '#37a06b'];
    const pieces = [[70, 80], [130, 110], [200, 75], [280, 120], [360, 80], [440, 115], [510, 78],
                    [100, 160], [240, 170], [400, 165], [500, 180], [170, 200], [330, 205], [470, 210]];
    pieces.forEach(([x, y], i) => {
      doc.fillColor(colors[i % colors.length]).opacity(0.75);
      if (i % 2) doc.circle(x > W - 40 ? W - 60 : x, y, 4).fill();
      else doc.rect((x > W - 40 ? W - 60 : x) - 4, y - 3, 8, 6).fill();
    });
  } else if (theme.motif === 'stars') {
    const gold = '#d4a017';
    const stars = [[80, 100, 12], [150, 75, 8], [W - 90, 105, 11], [W - 160, 72, 7], [W / 2, 85, 9]];
    doc.opacity(0.85);
    stars.forEach(([x, y, r], i) => {
      doc.fillColor(i % 2 ? gold : A);
      doc.polygon(...starPoints(x, y, r, r * 0.45)).fill();
    });
  } else if (theme.motif === 'waves') {
    doc.opacity(0.5);
    for (let k = 0; k < 3; k++) {
      const y = H - 150 + k * 22;
      doc.strokeColor(k === 1 ? A : '#7fb6bf').lineWidth(2.5)
        .moveTo(40, y)
        .bezierCurveTo(W * 0.3, y - 26, W * 0.45, y + 26, W * 0.7, y)
        .bezierCurveTo(W * 0.85, y - 18, W * 0.92, y + 10, W - 40, y)
        .stroke();
    }
  } else if (theme.motif === 'rings') {
    doc.opacity(0.8);
    doc.strokeColor(A).lineWidth(2.5);
    doc.circle(W / 2 - 28, 140, 32).stroke();
    doc.circle(W / 2 + 28, 140, 32).stroke();
  }
  doc.restore();
}

function starPoints(cx, cy, rOuter, rInner, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// ---- Página de narrativa ----
function drawNarrative(doc, { narrative, lang, theme }) {
  doc.addPage();
  drawTopBand(doc, theme);
  drawCornerMarks(doc, theme);
  doc.fontSize(20).fillColor(theme.deep).text(t(lang, 'album_narrative_title'));
  doc.moveDown(0.4);
  const rw = 48;
  doc.strokeColor(theme.accent).lineWidth(1.5).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + rw, doc.y).stroke();
  doc.moveDown(0.8);
  const paras = paragraphs(narrative);
  paras.forEach((p, i) => {
    if (i === 0) drawDropCapParagraph(doc, p, theme, 12);
    else { doc.fontSize(12).fillColor(INK).text(p, { align: 'justify', lineGap: 5 }); doc.moveDown(0.6); }
  });
}

// ---- Historia intermedia: icono + mini-historia propia, en página aparte ----
function drawStoryBlock(doc, { title, text, albumTitle, lang, theme }) {
  doc.addPage();
  const pg = doc.page;
  drawTopBand(doc, theme);
  drawCornerMarks(doc, theme);

  // Cabecera editorial
  doc.fontSize(9).fillColor(FAINT).text(truncate(albumTitle, 70), { align: 'right' });
  const hy = doc.y + 4;
  doc.strokeColor(theme.accent).lineWidth(0.75)
    .moveTo(pg.margins.left, hy).lineTo(pg.width - pg.margins.right, hy).stroke();
  doc.moveDown(2);

  // Icono vectorial: libro abierto
  const cx = pg.width / 2;
  const y0 = doc.y + 10;
  doc.save();
  doc.fillColor(theme.soft).strokeColor(theme.accent).lineWidth(1.5);
  doc.moveTo(cx, y0).lineTo(cx - 54, y0 - 10).lineTo(cx - 54, y0 + 36).lineTo(cx, y0 + 46).closePath().fillAndStroke();
  doc.moveTo(cx, y0).lineTo(cx + 54, y0 - 10).lineTo(cx + 54, y0 + 36).lineTo(cx, y0 + 46).closePath().fillAndStroke();
  doc.strokeColor(theme.accent).lineWidth(1);
  for (let k = 0; k < 3; k++) {
    const ly = y0 + 10 + k * 10;
    doc.moveTo(cx - 44, ly - 3).lineTo(cx - 12, ly).stroke();
    doc.moveTo(cx + 12, ly).lineTo(cx + 44, ly - 3).stroke();
  }
  doc.restore();
  doc.y = y0 + 66;

  doc.fontSize(10).fillColor(theme.accent)
    .text(t(lang, 'story_block').toUpperCase(), { align: 'center', characterSpacing: 1.5 });
  doc.moveDown(0.3);
  if (title) {
    doc.fontSize(20).fillColor(INK).text(title, { align: 'center' });
    doc.moveDown(0.6);
  }
  const rw = 48, rx = (pg.width - rw) / 2;
  doc.strokeColor(theme.accent).lineWidth(1.5).moveTo(rx, doc.y).lineTo(rx + rw, doc.y).stroke();
  doc.moveDown(0.8);
  const sparas = paragraphs(text);
  sparas.forEach((p, i) => {
    if (i === 0) drawDropCapParagraph(doc, p, theme, 11.5);
    else { doc.fontSize(11.5).fillColor(INK).text(p, { align: 'justify', lineGap: 4 }); doc.moveDown(0.5); }
  });
}

// ---- Página de un recuerdo: imagen arriba, texto debajo, nada se parte ----
async function drawMemory(doc, { m, idx, total, albumTitle, lang, theme }) {
  doc.addPage();
  const pg = doc.page;
  drawTopBand(doc, theme);
  drawCornerMarks(doc, theme);
  const maxW = pg.width - pg.margins.left - pg.margins.right;

  // Cabecera editorial: título del álbum + filete en el color de la temática
  doc.fontSize(9).fillColor(FAINT).text(truncate(albumTitle, 70), { align: 'right' });
  const hy = doc.y + 4;
  doc.strokeColor(theme.accent).lineWidth(0.75)
    .moveTo(pg.margins.left, hy).lineTo(pg.width - pg.margins.right, hy).stroke();
  doc.moveDown(1.2);

  // Imagen (foto o primer cuadro del video): va primera para que nunca quede
  // huérfana ni partida entre páginas.
  const img = await resolveImage(m);
  if (img) placeImageFit(doc, img, maxW, 380, theme);
  else if (m.video_path) drawVideoPlaceholder(doc, maxW, Math.min(300, maxW * 9 / 16));

  // Kicker, título y datos
  doc.fontSize(10).fillColor(theme.accent)
    .text(t(lang, 'memory_of', { n: idx, total }).toUpperCase(), { characterSpacing: 1.5 });
  doc.moveDown(0.3);
  doc.fontSize(20).fillColor(INK).text(m.title || '—');
  drawDivider(doc, theme);
  const meta = [fmtDate(m, lang), m.place].filter(Boolean).join(' · ');
  doc.fontSize(11).fillColor(MUTED).text(meta);
  if (m.people_names) doc.text(`${t(lang, 'people_label')}: ${m.people_names}`);
  doc.moveDown(0.8);

  // Botón de audio: enlace a la URL absoluta del archivo, con etiqueta en el
  // idioma del usuario. Requiere APP_URL configurada en el servidor.
  drawAudioButton(doc, { m, lang, theme });

  // Relato por párrafos justificados, con inicial decorada en el primero
  const sparas = paragraphs(m.story);
  sparas.forEach((p, i) => {
    if (i === 0) drawDropCapParagraph(doc, p, theme, 11.5);
    else { doc.fontSize(11.5).fillColor(INK).text(p, { align: 'justify', lineGap: 4 }); doc.moveDown(0.5); }
  });

  // Transcripción en bloque diferenciado
  if (m.transcription) {
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(MUTED).text(t(lang, 'transcription_label').toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.3);
    for (const p of paragraphs(m.transcription)) {
      doc.fontSize(10.5).fillColor('#4a4038').text(p, { align: 'justify', lineGap: 3 });
      doc.moveDown(0.4);
    }
  }

  // Documento adjunto: tarjeta con icono vectorial + narrativa extraída
  drawDocumentBlock(doc, { m, lang, theme });

  // Comentario opcional de la IA como nota de cierre
  drawAiComment(doc, { m, lang, theme });
}

// Tarjeta del documento adjunto: icono vectorial (las fuentes base no traen 📄),
// nombre del archivo y su narrativa extraída por párrafos.
function drawDocumentBlock(doc, { m, lang, theme }) {
  if (!m.doc_path) return;
  const pg = doc.page;
  const maxW = pg.width - pg.margins.left - pg.margins.right;
  doc.moveDown(0.4);
  const bottom = pg.height - pg.margins.bottom;
  if (doc.y + 90 > bottom) doc.addPage();
  const x = pg.margins.left, y = doc.y, w = maxW, h = 46;
  doc.save();
  doc.fillColor(theme.soft).roundedRect(x, y, w, h, 8).fill();
  doc.strokeColor(theme.accent).lineWidth(0.75).roundedRect(x, y, w, h, 8).stroke();
  // Icono: hoja con esquina doblada
  const ix = x + 16, iy = y + 9, iw = 20, ih = 28, f = 7;
  doc.fillColor(theme.accent);
  doc.polygon([ix, iy], [ix + iw - f, iy], [ix + iw, iy + f], [ix + iw, iy + ih], [ix, iy + ih]).fill();
  doc.fillColor(theme.soft);
  doc.polygon([ix + iw - f, iy], [ix + iw, iy + f], [ix + iw - f, iy + f]).fill();
  doc.fillColor('#ffffff');
  for (let k = 0; k < 3; k++) doc.rect(ix + 5, iy + 9 + k * 6, iw - 10, 1.6).fill();
  doc.restore();
  doc.fillColor(INK).fontSize(11)
    .text(t(lang, 'doc_label') + ': ' + (m.doc_name || 'documento'), ix + 30, y + 15, { width: w - 60 });
  doc.y = y + h;
  doc.moveDown(0.6);
  if (m.doc_text) {
    doc.fontSize(10).fillColor(MUTED).text(t(lang, 'doc_narrative_label').toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.3);
    for (const p of paragraphs(m.doc_text)) {
      doc.fontSize(10.5).fillColor('#4a4038').text(p, { align: 'justify', lineGap: 3 });
      doc.moveDown(0.4);
    }
  }
}

// Comentario de la IA: tarjeta con barra lateral en el color de la temática.
function drawAiComment(doc, { m, lang, theme }) {
  if (!m.ai_comment) return;
  const pg = doc.page;
  const maxW = pg.width - pg.margins.left - pg.margins.right;
  doc.moveDown(0.4);
  doc.fontSize(10.5);
  const textH = doc.heightOfString(m.ai_comment, { width: maxW - 56 });
  const h = 30 + textH + 22;
  const bottom = pg.height - pg.margins.bottom;
  if (doc.y + h > bottom) doc.addPage();
  const x = pg.margins.left, y = doc.y;
  doc.save();
  doc.fillColor(theme.soft).roundedRect(x, y, maxW, h, 8).fill();
  doc.strokeColor(theme.accent).lineWidth(0.75).roundedRect(x, y, maxW, h, 8).stroke();
  doc.fillColor(theme.accent).roundedRect(x, y, 6, h, 3).fill();
  // Estrella vectorial (las fuentes base no traen ✦)
  const sx = x + 22, sy = y + 22, r1 = 7, r2 = 2.8;
  doc.polygon(...starPoints(sx, sy, r1, r2, 4)).fill();
  doc.restore();
  doc.fillColor(theme.deep).fontSize(10).text(t(lang, 'ai_comment_label'), x + 36, y + 13);
  doc.fillColor(INK).fontSize(10.5).text(m.ai_comment, x + 36, y + 30, { width: maxW - 56 });
  doc.y = y + h;
  doc.moveDown(0.8);
}

// Botón "Escuchar audio": rectángulo con el color de la temática y texto blanco,
// que enlaza a la URL absoluta del audio (APP_URL + ruta). La etiqueta va en el
// idioma del usuario. Si no hay APP_URL o el archivo no existe, no se dibuja.
function drawAudioButton(doc, { m, lang, theme }) {
  if (!m.audio_path) return;
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!base) return;
  const abs = path.join(UPLOAD_DIR(), path.basename(m.audio_path));
  if (!fs.existsSync(abs)) return;
  const label = t(lang, 'listen_audio');
  doc.fontSize(11);
  const bw = doc.widthOfString(label) + 40;
  const bh = 28;
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + bh > bottom) doc.addPage();
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, bw, bh, 9).fill(theme.accent);
  doc.fillColor('#ffffff')
    .text(label, x, y + 8.5, { width: bw, align: 'center', link: base + m.audio_path });
  doc.restore();
  doc.y = y + bh;
  doc.fillColor(INK);
  doc.moveDown(0.8);
}

// Foto existente, o miniatura del primer cuadro del video (se genera si falta).
async function resolveImage(m) {
  if (m.photo_path) {
    const p = path.join(UPLOAD_DIR(), path.basename(m.photo_path));
    if (fs.existsSync(p)) return p;
  }
  if (m.video_path) {
    try {
      return await ensureVideoThumb(path.join(UPLOAD_DIR(), path.basename(m.video_path)));
    } catch (e) { return null; }
  }
  return null;
}

// Dibuja una imagen centrada ajustada a maxW×maxH SIN distorsión: se usa la
// opción `fit` de pdfkit (escala uniforme) y el tamaño real se calcula igual
// que lo hace pdfkit, incluyendo el intercambio de ancho/alto que exige la
// orientación EXIF (las fotos verticales de teléfono suelen traerla).
// Después de image() se AVANZA el cursor (pdfkit no lo mueve solo).
function placeImageFit(doc, absPath, maxW, maxH, theme) {
  const img = doc.openImage(absPath);
  let iw = img.width, ih = img.height;
  if (img.orientation > 4) { const tmp = iw; iw = ih; ih = tmp; }
  const bp = maxW / maxH, ip = iw / ih;
  let w, h;
  if (ip > bp) { w = maxW; h = maxW / ip; } else { h = maxH; w = maxH * ip; }
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + h > bottom) doc.addPage();
  const x = (doc.page.width - w) / 2;
  const y0 = doc.y;
  doc.image(img, x, y0, { fit: [maxW, maxH] });
  // Doble marco: exterior en el color de la temática, interior tenue.
  const accent = (theme && theme.accent) || RULE;
  doc.strokeColor(accent).lineWidth(1.2).rect(x - 4, y0 - 4, w + 8, h + 8).stroke();
  doc.strokeColor(RULE).lineWidth(0.5).rect(x, y0, w, h).stroke();
  doc.y = y0 + h;
  doc.moveDown(0.8);
}

// Recuadro oscuro con símbolo de reproducción cuando no se pudo obtener la miniatura del video.
function drawVideoPlaceholder(doc, w, h) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + h > bottom) doc.addPage();
  const x = (doc.page.width - w) / 2;
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fill('#1f2937');
  // Triángulo dibujado con vectores: las fuentes base de pdfkit no traen el glifo ▶.
  const cx = x + w / 2, cy = y + h / 2 - 10, s = 30;
  doc.polygon([cx - s * 0.55, cy - s], [cx - s * 0.55, cy + s], [cx + s * 0.75, cy]).fill('#ffffff');
  doc.fontSize(12).fillColor('#d1d5db').text('Video', x, y + h - 42, { width: w, align: 'center' });
  doc.restore();
  doc.y = y + h;
  doc.moveDown(0.8);
}

module.exports = { generateAlbumPDF };

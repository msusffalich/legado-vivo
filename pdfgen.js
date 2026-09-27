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

function generateAlbumPDF({ family, album, memories, lang }) {
  return (async () => {
    const theme = themeOf(album.theme);
    const doc = new PDFDocument({ margin: 56, size: 'A4', bufferPages: true });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    drawCover(doc, { family, album, memories, lang, theme });

    const narrative = album.narrative && String(album.narrative).trim();
    if (narrative) drawNarrative(doc, { narrative, lang, theme });

    for (let i = 0; i < memories.length; i++) {
      await drawMemory(doc, { m: memories[i], idx: i, total: memories.length, albumTitle: album.title, lang, theme });
    }

    // Números de página al pie (todas las páginas menos la portada).
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(i);
      const pg = doc.page;
      doc.fontSize(9).fillColor(FAINT).text(
        String(i + 1),
        pg.margins.left,
        pg.height - 38,
        { width: pg.width - pg.margins.left - pg.margins.right, align: 'center' }
      );
    }

    doc.end();
    return done;
  })();
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
  doc.fontSize(20).fillColor(theme.deep).text(t(lang, 'album_narrative_title'));
  doc.moveDown(0.4);
  const rw = 48;
  doc.strokeColor(theme.accent).lineWidth(1.5).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + rw, doc.y).stroke();
  doc.moveDown(0.8);
  for (const p of paragraphs(narrative)) {
    doc.fontSize(12).fillColor(INK).text(p, { align: 'justify', lineGap: 5 });
    doc.moveDown(0.6);
  }
}

// ---- Página de un recuerdo: imagen arriba, texto debajo, nada se parte ----
async function drawMemory(doc, { m, idx, total, albumTitle, lang, theme }) {
  doc.addPage();
  const pg = doc.page;
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
  if (img) placeImageFit(doc, img, maxW, 380);
  else if (m.video_path) drawVideoPlaceholder(doc, maxW, Math.min(300, maxW * 9 / 16));

  // Kicker, título y datos
  doc.fontSize(10).fillColor(theme.accent)
    .text(t(lang, 'memory_of', { n: idx + 1, total }).toUpperCase(), { characterSpacing: 1.5 });
  doc.moveDown(0.3);
  doc.fontSize(20).fillColor(INK).text(m.title || '—');
  doc.moveDown(0.3);
  const meta = [fmtDate(m, lang), m.place].filter(Boolean).join(' · ');
  doc.fontSize(11).fillColor(MUTED).text(meta);
  if (m.people_names) doc.text(`${t(lang, 'people_label')}: ${m.people_names}`);
  doc.moveDown(0.8);

  // Relato por párrafos justificados
  for (const p of paragraphs(m.story)) {
    doc.fontSize(11.5).fillColor(INK).text(p, { align: 'justify', lineGap: 4 });
    doc.moveDown(0.5);
  }

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

// Dibuja una imagen centrada ajustada a maxW×maxH, con marco fino, y AVANZA el
// cursor de texto (pdfkit no mueve doc.y tras image(), lo que antes encimaba el texto).
function placeImageFit(doc, absPath, maxW, maxH) {
  const img = doc.openImage(absPath);
  const s = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * s, h = img.height * s;
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + h > bottom) doc.addPage();
  const x = (doc.page.width - w) / 2;
  const y0 = doc.y;
  doc.image(img, x, y0, { width: w, height: h });
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

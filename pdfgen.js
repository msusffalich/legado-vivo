'use strict';
// Generación del álbum PDF con pdfkit.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

function fmtDate(m, lang) {
  const d0 = m.memory_date;
  const iso = d0 instanceof Date ? (isNaN(d0) ? '' : d0.toISOString().slice(0, 10)) : String(d0 || '').slice(0, 10);
  if (!iso) return t(lang, 'no_date');
  const d = new Date(iso + 'T12:00:00');
  const s = d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  if (m.date_precision === 'approx') return (lang === 'en' ? 'c. ' : 'aprox. ') + s;
  return s;
}

function generateAlbumPDF({ family, album, memories, lang }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Portada
    doc.moveDown(6);
    doc.fontSize(14).fillColor('#6b5b4c').text(family.name, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(30).fillColor('#2b2118').text(album.title, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#6b5b4c').text(
      `${memories.length} ${lang === 'en' ? 'memories' : 'recuerdos'} · ${new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES')}`,
      { align: 'center' }
    );
    doc.moveDown(2);
    doc.fontSize(11).fillColor('#8a7a68').text(t(lang, 'app_tagline'), { align: 'center' });

    for (const m of memories) {
      doc.addPage();
      doc.fontSize(20).fillColor('#2b2118').text(m.title || '—');
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#6b5b4c').text(fmtDate(m, lang));
      if (m.place) doc.text(`${t(lang, 'place_label')}: ${m.place}`);
      if (m.people_names) doc.text(`${t(lang, 'people_label')}: ${m.people_names}`);
      doc.moveDown(0.8);
      if (m.photo_path) {
        const p = path.join(UPLOAD_DIR(), path.basename(m.photo_path));
        try {
          if (fs.existsSync(p)) doc.image(p, { fit: [480, 320], align: 'center' });
          doc.moveDown(0.8);
        } catch (e) { /* imagen ilegible: se omite */ }
      }
      if (m.story) {
        doc.fontSize(12).fillColor('#2b2118').text(m.story, { align: 'justify' });
        doc.moveDown(0.6);
      }
      if (m.transcription) {
        doc.fontSize(11).fillColor('#4a4038').text(`${t(lang, 'transcription_label')}: ${m.transcription}`, { align: 'justify' });
      }
    }
    doc.end();
  });
}

module.exports = { generateAlbumPDF };

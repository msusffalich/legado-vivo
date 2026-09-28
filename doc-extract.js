'use strict';
// Extracción de texto de documentos adjuntos (PDF, Word, texto plano)
// para usarlo como narrativa del recuerdo.
// Sin dependencias nativas: pdf-parse y mammoth son JS puro.
const fs = require('fs');
const path = require('path');

const DOC_MAX_CHARS = 20000; // tope de texto extraído por documento

function cleanText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, DOC_MAX_CHARS);
}

async function extractPdf(absPath) {
  const { PDFParse } = require('pdf-parse');
  const buf = fs.readFileSync(absPath);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  return cleanText(result && result.text);
}

async function extractDocx(absPath) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ path: absPath });
  return cleanText(value);
}

function extractTxt(absPath) {
  const buf = fs.readFileSync(absPath);
  return cleanText(buf.toString('utf8'));
}

// Devuelve { ok, text } — text puede venir vacío si el documento no trae
// texto extraíble (p. ej. PDF escaneado sin OCR).
async function extractDocText(absPath, originalName) {
  const ext = path.extname(originalName || absPath || '').toLowerCase().replace(/^\./, '');
  try {
    if (ext === 'pdf') {
      const text = await extractPdf(absPath);
      return { ok: true, text };
    }
    if (ext === 'docx') {
      const text = await extractDocx(absPath);
      return { ok: true, text };
    }
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      return { ok: true, text: extractTxt(absPath) };
    }
    return { ok: false, error: 'badtype' };
  } catch (e) {
    console.error('[doc-extract]', ext, e.message);
    return { ok: false, error: 'extract-failed' };
  }
}

module.exports = { extractDocText, DOC_MAX_CHARS };

'use strict';
// Sidecar .md de un recuerdo: frontmatter YAML con los datos estructurados
// (fecha, lugar, personas, enlace al Diario) para que el proceso que genera
// las notas del vault de Obsidian los lea directamente, sin extraerlos del
// PDF/documento del recuerdo.
//
// Contrato:
//   ---
//   fecha: AAAA-MM-DD              (se omite si no hay fecha o es 'unknown')
//   lugar: "Sitio, Región"         (tal cual está en la BD)
//   personas: ["Nombre1", "Nombre2"]
//   diario: "[[Viernes 9 de octubre de 2026]]"   (solo con fecha válida)
//   ---
//
// Nunca se inventan fechas: si memory_date es NULL o date_precision es
// 'unknown', la línea de fecha (y la del diario) simplemente no se emite.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Normaliza DATE de Postgres (objeto Date) o string a 'AAAA-MM-DD'.
function memDateISO(m) {
  const d = m && m.memory_date;
  if (!d) return '';
  if (d instanceof Date) return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// 'AAAA-MM-DD' -> 'Viernes 9 de octubre de 2026' (formato del Diario).
// Devuelve null si la fecha no es válida.
function diarioTitle(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const d = new Date(iso + 'T12:00:00'); // mediodía: evita corrimientos de día por zona horaria
  if (isNaN(d)) return null;
  return `${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Escapa un string para YAML: siempre entre comillas dobles.
function ystr(s) {
  return '"' + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t') + '"';
}

// memory: fila de la tabla memories. people: array de nombres (strings).
// Devuelve el contenido completo del archivo .md sidecar.
function buildSidecar(memory, people) {
  const iso = memDateISO(memory);
  const hasDate = Boolean(iso) && memory.date_precision !== 'unknown';
  const names = Array.isArray(people) ? people.filter(Boolean).map(String) : [];
  const lines = ['---'];
  if (hasDate) lines.push(`fecha: ${iso}`);
  lines.push(`lugar: ${ystr(memory.place || '')}`);
  lines.push(`personas: [${names.map(ystr).join(', ')}]`);
  if (hasDate) {
    const t = diarioTitle(iso);
    if (t) lines.push(`diario: ${ystr('[[' + t + ']]')}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

// Nombre base del sidecar: el mismo que el documento del recuerdo
// (ej. "Mi-recuerdo.pdf" -> "Mi-recuerdo.md"); si no hay documento,
// se usa el título del recuerdo saneado.
function sidecarBaseName(memory) {
  let base = '';
  if (memory.doc_name) base = String(memory.doc_name).replace(/\.[^.]+$/, '');
  if (!base && memory.title) base = String(memory.title);
  base = base.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return base || 'recuerdo';
}

module.exports = { buildSidecar, diarioTitle, memDateISO, sidecarBaseName };

'use strict';
// Only structured, stored metadata is exported; no AI or upload timestamps.
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function memDateISO(memory) {
  const value = memory && memory.memory_date;
  // The route reads PostgreSQL DATE as text to avoid timezone shifts.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}
function diarioTitle(iso) {
  if (!memDateISO({ memory_date: iso })) return null;
  const d = new Date(iso + 'T12:00:00Z');
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
function buildSidecar(memory, people) {
  const iso = memDateISO(memory);
  const hasDate = iso && ['exact', 'approx'].includes(memory.date_precision);
  const names = Array.isArray(people) ? people.filter(n => typeof n === 'string' && n.trim()) : [];
  const lines = ['---'];
  if (hasDate) {
    lines.push(`fecha: ${JSON.stringify(iso)}`);
    // An approximate date must never be presented as a verified exact day.
    lines.push(`precision_fecha: ${JSON.stringify(memory.date_precision)}`);
  }
  lines.push(`lugar: ${JSON.stringify(memory.place || '')}`);
  lines.push(`personas: ${JSON.stringify(names)}`);
  if (hasDate && memory.date_precision === 'exact') lines.push(`diario: ${JSON.stringify('[[' + diarioTitle(iso) + ']]')}`);
  lines.push('---', '');
  return lines.join('\n');
}
function sidecarBaseName(memory) {
  let base = String(memory.doc_name || '').replace(/\.[^.]+$/, '') || String(memory.title || '');
  base = base.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  return base || 'recuerdo';
}
module.exports = { buildSidecar, diarioTitle, memDateISO, sidecarBaseName };

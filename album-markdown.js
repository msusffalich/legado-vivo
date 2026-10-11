'use strict';
const { memDateISO, sidecarBaseName } = require('./sidecar');
const quote = value => JSON.stringify(value);
function text(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
}
function buildAlbumMarkdown({ album, items, lang = 'es' }) {
  const records = items.filter(it => it.kind === 'memory').map(({ memory: m }) => {
    const entry = { id: m.id, titulo: m.title || '', lugar: m.place || '', personas: m.people || [] };
    const iso = memDateISO(m);
    if (iso && ['exact', 'approx'].includes(m.date_precision)) {
      entry.fecha = iso; entry.precision_fecha = m.date_precision;
    }
    return entry;
  });
  // One frontmatter for the entire album. JSON arrays/objects are valid YAML.
  const lines = ['---', `titulo: ${quote(album.title || '')}`, `album_id: ${quote(album.id)}`,
    `recuerdos: ${quote(records)}`, '---', '', '# ' + text(album.title), ''];
  if (album.narrative) lines.push(text(album.narrative), '');
  for (const [index, item] of items.entries()) {
    if (item.kind === 'story') {
      lines.push(`## ${index + 1}. ${text(item.title || (lang === 'en' ? 'Story' : 'Historia'))}`, '', text(item.text), '');
      continue;
    }
    const m = item.memory;
    lines.push(`## ${index + 1}. ${text(m.title || (lang === 'en' ? 'Memory' : 'Recuerdo'))}`, '');
    const iso = memDateISO(m);
    if (iso && ['exact', 'approx'].includes(m.date_precision)) lines.push(`- ${lang === 'en' ? 'Date' : 'Fecha'}: ${iso}${m.date_precision === 'approx' ? (lang === 'en' ? ' (approximate)' : ' (aproximada)') : ''}`);
    if (m.place) lines.push(`- ${lang === 'en' ? 'Place' : 'Lugar'}: ${text(m.place)}`);
    if ((m.people || []).length) lines.push(`- ${lang === 'en' ? 'People' : 'Personas'}: ${m.people.map(text).join('; ')}`);
    lines.push('');
    if (m.story) lines.push(text(m.story), '');
    if (m.doc_text && m.doc_text !== m.story) lines.push(`### ${lang === 'en' ? 'Document' : 'Documento'}`, '', text(m.doc_text), '');
    if (m.transcription && m.transcription !== m.story && m.transcription !== m.doc_text) lines.push(`### ${lang === 'en' ? 'Transcription' : 'Transcripción'}`, '', text(m.transcription), '');
  }
  return lines.join('\n');
}
module.exports = { buildAlbumMarkdown, albumMarkdownName: album => sidecarBaseName({ title: album.title || 'album' }) + '.md' };

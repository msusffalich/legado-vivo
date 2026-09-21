'use strict';
// Integración opcional con OpenAI. Sin OPENAI_API_KEY, todo devuelve null
// y la app degrada a flujos manuales / búsqueda por palabras clave.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function chatCompletion(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 2000 }),
    });
    if (!resp.ok) {
      console.error('[ai] OpenAI respondió', resp.status);
      return null;
    }
    const data = await resp.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    return text ? text.trim() : null;
  } catch (err) {
    console.error('[ai] error llamando a OpenAI:', err.message);
    return null;
  }
}

function memorySummary(m) {
  const parts = [];
  if (m.title) parts.push('Título: ' + m.title);
  if (m.memory_date) parts.push('Fecha: ' + m.memory_date + (m.date_precision === 'exact' ? '' : ' (' + m.date_precision + ')'));
  if (m.place) parts.push('Lugar: ' + m.place);
  if (m.people_names) parts.push('Personas: ' + m.people_names);
  if (m.story) parts.push('Relato: ' + m.story);
  if (m.transcription) parts.push('Transcripción: ' + m.transcription);
  return parts.join('\n');
}

async function generateStory(memories, lang) {
  const intro = lang === 'en'
    ? 'Write a warm family story in English based on these memories. Keep facts faithful; do not invent names, dates or places not present.'
    : 'Escribe una historia familiar cálida en español neutro a partir de estos recuerdos. Sé fiel a los hechos; no inventes nombres, fechas ni lugares que no aparezcan.';
  const body = memories.map((m, i) => `--- Recuerdo ${i + 1} ---\n${memorySummary(m)}`).join('\n\n');
  return chatCompletion([
    { role: 'system', content: intro },
    { role: 'user', content: body },
  ]);
}

async function conversationalSearch(question, memories, lang) {
  const sys = lang === 'en'
    ? 'You answer questions using ONLY the family memories below. Cite which memories you used by their titles. If the answer is not in the memories, say so honestly. Reply in English.'
    : 'Respondes preguntas usando SOLO los recuerdos familiares de abajo. Cita qué recuerdos usaste por su título. Si la respuesta no está en los recuerdos, dilo con honestidad. Responde en español neutro.';
  const body = memories.map((m, i) => `--- Recuerdo ${i + 1}: ${m.title} ---\n${memorySummary(m)}`).join('\n\n');
  return chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: `Pregunta: ${question}\n\nRecuerdos:\n${body}` },
  ]);
}

function aiEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

module.exports = { generateStory, conversationalSearch, aiEnabled };

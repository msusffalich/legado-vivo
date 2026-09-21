'use strict';
// Puente con el Asistente Puente (WhatsApp).
// POST /api/bridge/drafts  — header x-bridge-key: <BRIDGE_API_KEY>
// Body JSON: {
//   draftId: "wa-12345",            (requerido: idempotencia)
//   familyId: 3,                    (requerido)
//   title?, text?, transcription?, place?,
//   people?: ["Mamá", "Tío Juan"],
//   date?: "1985-06-12", datePrecision?: "exact|approx|unknown",
//   photoBase64?, photoFilename?, audioBase64?, audioFilename?
// }
// Crea el recuerdo como "Pendiente de completar". Si el draftId ya existe,
// devuelve el recuerdo existente (sin duplicar).
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

function checkKey(req, res, next) {
  const expected = process.env.BRIDGE_API_KEY || '';
  const got = req.get('x-bridge-key') || '';
  if (!expected || got.length !== expected.length) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff !== 0) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

const ALLOWED_EXTENSIONS = {
  photo: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']),
  audio: new Set(['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac', '.flac']),
};

function saveBase64(b64, filename, kind) {
  if (!b64) return null;
  const fallback = kind === 'photo' ? 'photo.jpg' : 'audio.ogg';
  const safe = (filename || fallback).replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const ext = path.extname(safe).toLowerCase();
  if (!ALLOWED_EXTENSIONS[kind].has(ext)) return null;
  const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safe;
  const buf = Buffer.from(String(b64).split(',').pop(), 'base64');
  if (!buf.length || buf.length > 25 * 1024 * 1024) return null;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

router.post('/drafts', checkKey, async (req, res) => {
  const b = req.body || {};
  const draftId = (b.draftId || '').trim();
  const familyId = parseInt(b.familyId, 10);
  if (!draftId) return res.status(400).json({ ok: false, error: 'draftId required' });
  if (!familyId) return res.status(400).json({ ok: false, error: 'familyId required' });

  const { rows: fam } = await db.query('SELECT id FROM families WHERE id=$1', [familyId]);
  if (!fam.length) return res.status(404).json({ ok: false, error: 'family not found' });

  const { rows: dup } = await db.query('SELECT id FROM memories WHERE bridge_draft_id=$1', [draftId]);
  if (dup.length) return res.json({ ok: true, memoryId: dup[0].id, duplicate: true });

  const photo = saveBase64(b.photoBase64, b.photoFilename || 'photo.jpg', 'photo');
  const audio = saveBase64(b.audioBase64, b.audioFilename || 'audio.ogg', 'audio');
  const story = b.text || b.story || '';
  const title = (b.title || '').trim() || story.split('\n')[0].slice(0, 80) || 'Recuerdo del asistente';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO memories (family_id, title, story, transcription, place, memory_date, date_precision,
        photo_path, audio_path, status, bridge_draft_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10) RETURNING id`,
      [familyId, title, story, b.transcription || '', (b.place || '').trim() || '',
       (b.date || '').trim() || null,
       ['exact', 'approx'].includes(b.datePrecision) ? b.datePrecision : 'unknown',
       photo, audio, draftId]
    );
    const mid = rows[0].id;
    const names = Array.isArray(b.people) ? b.people : [];
    for (const raw of names) {
      const nm = String(raw || '').trim();
      if (!nm) continue;
      let pr = await client.query('SELECT id FROM persons WHERE family_id=$1 AND lower(name)=lower($2)', [familyId, nm]);
      let pid;
      if (pr.rows.length) pid = pr.rows[0].id;
      else {
        const ins = await client.query('INSERT INTO persons (family_id, name) VALUES ($1,$2) RETURNING id', [familyId, nm]);
        pid = ins.rows[0].id;
      }
      await client.query('INSERT INTO memory_people (memory_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mid, pid]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, memoryId: mid, duplicate: false });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;

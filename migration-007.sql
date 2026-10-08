-- 007: galería de fotos por recuerdo (subida múltiple).
CREATE TABLE IF NOT EXISTS memory_photos (
  id SERIAL PRIMARY KEY,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_photos_memory_idx ON memory_photos(memory_id);
-- Relleno: la foto principal existente pasa a ser la foto 0 de la galería.
INSERT INTO memory_photos (memory_id, photo_path, sort_order)
SELECT id, photo_path, 0 FROM memories
WHERE photo_path IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM memory_photos mp WHERE mp.memory_id = memories.id);

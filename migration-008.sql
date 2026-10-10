-- Multiple videos; preserve the existing principal video for older views/exports.
CREATE TABLE IF NOT EXISTS memory_videos (
  id SERIAL PRIMARY KEY,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  video_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_videos_memory_idx ON memory_videos(memory_id);
INSERT INTO memory_videos (memory_id, video_path, sort_order)
SELECT id, video_path, 0 FROM memories
WHERE video_path IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM memory_videos mv WHERE mv.memory_id=memories.id);

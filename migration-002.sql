-- migration-002: soporte de video en recuerdos
ALTER TABLE memories ADD COLUMN IF NOT EXISTS video_path TEXT NULL;

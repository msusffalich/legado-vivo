-- 005: video y foto por URL (YouTube / Instagram / URL directa de imagen).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS video_dl_status TEXT DEFAULT 'ready';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS video_dl_error TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS photo_dl_status TEXT DEFAULT 'ready';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS photo_dl_error TEXT;

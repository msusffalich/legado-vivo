-- migration-004: temática visual del álbum (decorado del PDF según la temática elegida).
ALTER TABLE albums ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'general';

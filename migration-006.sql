-- 006: documentos adjuntos con narrativa extraída + comentario opcional de la IA.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS doc_path TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS doc_name TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS doc_text TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS ai_comment TEXT NOT NULL DEFAULT '';

-- migration-003: narrativa del álbum (historia/introducción escrita por el usuario;
-- aparece tras la portada en el PDF y en la página del álbum).
ALTER TABLE albums ADD COLUMN IF NOT EXISTS narrative TEXT NOT NULL DEFAULT '';

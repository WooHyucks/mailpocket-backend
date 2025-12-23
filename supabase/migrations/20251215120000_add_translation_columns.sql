-- Add translated_body to store Korean translations of foreign newsletters
ALTER TABLE mail
ADD COLUMN IF NOT EXISTS translated_body TEXT;

-- Track newsletter language to decide whether translation is needed
ALTER TABLE newsletter
ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'ko';


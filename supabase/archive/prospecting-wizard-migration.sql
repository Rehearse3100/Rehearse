-- Optional: persist Tempo prospecting wizard draft state on attempts
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS stage_data jsonb;

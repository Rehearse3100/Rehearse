-- Class card appearance columns (run in Supabase SQL editor if Save Appearance fails)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS card_image_url text;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS card_color_scheme text DEFAULT 'default';
-- Refresh PostgREST so the API sees new columns immediately
NOTIFY pgrst, 'reload schema';

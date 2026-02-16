
BEGIN;

-- Ensure bucket exists and is public (user said they created it, but good to ensure 'public' flag)
-- We can't easily insert if it exists, but we can update.
-- Actually, let's just focus on policies.

-- Drop existing policies if any to avoid conflicts (or use IF NOT EXISTS if supported, but policies don't support IF NOT EXISTS in all versions, easier to drop)
DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes" ON storage.objects;

-- Create Policies
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Allow public reads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'post-images');

CREATE POLICY "Allow public updates"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'post-images');

CREATE POLICY "Allow public deletes"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'post-images');

COMMIT;

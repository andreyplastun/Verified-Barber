-- Migration for Anti-Fraud System
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard -> SQL Editor)

-- 1. Add valid_review_count column to specialists table
ALTER TABLE specialists 
ADD COLUMN IF NOT EXISTS valid_review_count integer DEFAULT 0;

-- 2. Add antifraud columns to reviews table
ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS normalized_text text;

ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS is_rating_limited boolean DEFAULT false;

ALTER TABLE reviews 
ADD COLUMN IF NOT EXISTS rating_limit_reason text;

-- 3. Update valid_review_count for all existing specialists based on non-limited reviews
UPDATE specialists s
SET valid_review_count = (
  SELECT COUNT(*) 
  FROM reviews r 
  WHERE r.specialist_id = s.id 
  AND (r.is_rating_limited IS NULL OR r.is_rating_limited = false)
);

-- Verify the changes
SELECT 'specialists columns:' as info;
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'specialists' 
AND column_name = 'valid_review_count';

SELECT 'reviews columns:' as info;
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND column_name IN ('normalized_text', 'is_rating_limited', 'rating_limit_reason');

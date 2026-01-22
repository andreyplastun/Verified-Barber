-- Migration for Anti-Fraud System + Dual Rating System
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard -> SQL Editor)

-- 1. Add rating columns to specialists table
ALTER TABLE specialists 
ADD COLUMN IF NOT EXISTS valid_review_count integer DEFAULT 0;

ALTER TABLE specialists 
ADD COLUMN IF NOT EXISTS trusted_rating integer DEFAULT 0;

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

-- 4. Recalculate ratings for all specialists
WITH review_stats AS (
  SELECT 
    specialist_id,
    COUNT(*) as total_count,
    ROUND(AVG(rating) * 10) as base_rating,
    COUNT(*) FILTER (WHERE is_rating_limited = false OR is_rating_limited IS NULL) as valid_count,
    COALESCE(ROUND(AVG(rating) FILTER (WHERE is_rating_limited = false OR is_rating_limited IS NULL) * 10), 0) as trusted_rating
  FROM reviews
  WHERE is_finalized = true AND publish_review = true
  GROUP BY specialist_id
)
UPDATE specialists s
SET 
  review_count = rs.total_count,
  average_rating = rs.base_rating,
  trusted_rating = rs.trusted_rating,
  valid_review_count = rs.valid_count
FROM review_stats rs
WHERE s.id = rs.specialist_id;

-- Verify the changes
SELECT 'specialists columns:' as info;
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'specialists' 
AND column_name IN ('valid_review_count', 'trusted_rating');

SELECT 'reviews columns:' as info;
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'reviews' 
AND column_name IN ('normalized_text', 'is_rating_limited', 'rating_limit_reason');

-- Show updated specialists
SELECT id, name, review_count, average_rating, trusted_rating, valid_review_count 
FROM specialists 
WHERE review_count > 0
ORDER BY review_count DESC;

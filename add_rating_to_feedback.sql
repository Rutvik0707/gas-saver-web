-- Add rating column to feedback table
ALTER TABLE feedback 
ADD COLUMN IF NOT EXISTS rating INTEGER;

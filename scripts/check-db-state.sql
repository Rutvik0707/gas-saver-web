-- Check current database state

-- 1. Check total users and users without phone numbers
SELECT 
    COUNT(*) as total_users,
    COUNT(CASE WHEN phone_number IS NULL THEN 1 END) as users_without_phone,
    COUNT(CASE WHEN tron_address IS NOT NULL THEN 1 END) as users_with_tron_address
FROM users;

-- 2. Show sample of users
SELECT id, email, phone_number, tron_address, created_at
FROM users
LIMIT 5;

-- 3. Check if password_hash is already nullable
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' 
AND column_name IN ('password_hash', 'phone_number', 'tron_address');

-- 4. Check existing TRON addresses in user_tron_addresses
SELECT COUNT(*) as total_tron_addresses
FROM user_tron_addresses;
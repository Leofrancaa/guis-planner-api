-- Rename email column to username on User table
-- Step 1: Add username as nullable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Step 2: Copy existing email values as username (derive from email prefix or use id fallback)
UPDATE "User" SET "username" = split_part("email", '@', 1) WHERE "email" IS NOT NULL;
-- Fallback for any null values
UPDATE "User" SET "username" = 'user.' || substring("id", 1, 8) WHERE "username" IS NULL;

-- Step 3: Make NOT NULL
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- Step 4: Drop old email column
ALTER TABLE "User" DROP COLUMN "email";

-- Step 5: Add unique constraint
ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");

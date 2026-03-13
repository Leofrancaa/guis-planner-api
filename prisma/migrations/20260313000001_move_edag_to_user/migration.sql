-- Move edag from StudentSubject to User, and add PushSubscription table

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "edag" DOUBLE PRECISION;
ALTER TABLE "StudentSubject" DROP COLUMN IF EXISTS "edag";

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "endpoint"  TEXT NOT NULL,
    "p256dh"    TEXT NOT NULL,
    "auth"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_endpoint_key";
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_endpoint_key" UNIQUE ("endpoint");

ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey";
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

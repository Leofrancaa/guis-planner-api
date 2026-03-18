ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "gradeLabel" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Event_subjectId_gradeLabel_unique"
  ON "Event"("subjectId", "gradeLabel")
  WHERE "subjectId" IS NOT NULL AND "gradeLabel" IS NOT NULL;

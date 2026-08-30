-- Rename the Role enum value SCHEDULER -> ADMIN in place, preserving existing rows.
-- A default Prisma-generated migration would create a new enum type, cast the
-- column, and drop the old type, which breaks/loses existing SCHEDULER rows
-- since 'SCHEDULER' has no corresponding value in the new type at cast time.
ALTER TYPE "Role" RENAME VALUE 'SCHEDULER' TO 'ADMIN';

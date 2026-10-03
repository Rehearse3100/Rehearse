# Archived SQL migrations

These files are **historical**. They must **not** be run against any database.

The only setup file is [`../FULL-SETUP.sql`](../FULL-SETUP.sql). It is idempotent and reproduces the current secured greenfield schema (including RLS ownerless-row protection, scrubbed Tempo persona prompt, and column-level hide of `students.password_hash`).

Keep this folder for archaeology and brownfield forensics only.

# Course scope, menu documents, and capacity audit

## Migration

Apply `selfhost/migrations/021_course_scope_and_menu_documents.sql` after
migration 020. It adds `client_courses.program_scope`, backfills it only from
existing published assignments (`nutrition`, `training`, or `both`, with
`both` as the no-assignment compatibility default), creates a scope-change
audit log, and creates immutable/versioned nutrition-document metadata.

The migration does not update or delete nutrition/training versions,
assignments, snapshots, or `content_hash`. Changing `program_scope` only
changes authorization. Existing published data becomes visible again unchanged
when its section is re-enabled.

## Storage and backup

Set `SELFHOST_MEDIA_ROOT` to a durable directory outside the release tree.
Documents are stored under its `nutrition-documents` subdirectory with an
opaque UUID filename. There is no public static URL. Every view/download goes
through the authenticated endpoint and rechecks the session client, course,
and `program_scope`.

`scripts/backup-selfhost.sh` backs up PostgreSQL and all files under
`SELFHOST_MEDIA_ROOT`, then writes SHA-256 checksums. Published documents are
never physically deleted by the admin UI.

## Deploy

1. Back up PostgreSQL and `SELFHOST_MEDIA_ROOT`.
2. Provision/verify a durable `SELFHOST_MEDIA_ROOT` with write access for the
   application user and include it in backup retention.
3. Install locked dependencies with Node 22.12 or newer.
4. Apply migration 021 explicitly using the existing selfhost migrator.
5. Build the release and run smoke tests before switching the release symlink.
6. Verify all three course scopes, client A/B isolation, PDF/DOCX view/download,
   and both legacy snapshot PDFs.

## Rollback

1. Switch the application release back to the previous release.
2. Do **not** delete the uploaded document directory.
3. Leave migration 021 in place during application rollback: the added column
   has a compatible `both` default and the new tables are not referenced by the
   previous build.
4. If a full schema rollback is mandatory, first export
   `client_course_scope_changes` and `nutrition_documents`, verify file backups,
   then drop the document trigger/function/tables and finally drop
   `client_courses.program_scope`. This intentionally does not touch published
   program versions, assignments, snapshots, or hashes.

## Verification completed locally

- Node 22.14.0: 78 focused tests, including the PostgreSQL integration suite.
- Migrations 001–021 on a clean PostgreSQL 16 database and an idempotent second
  pass with all 21 migrations skipped.
- TypeScript typecheck, ESLint on changed source files, production build, and
  `git diff --check`.
- Local Chrome desktop/mobile smoke with synthetic users: all three scopes,
  direct-URL authorization, PDF/DOCX upload/version/view/download, client
  isolation, nutrition/training PDFs, and complete training exercise details.
- Published nutrition/training snapshots and `content_hash` remained unchanged
  across scope changes and document publication.

## Capacity laboratory result

The local stand used the production build under Node 22 with a 1 CPU / 2 GiB
container limit, PostgreSQL 16 with 1 CPU / 768 MiB, and the official k6 image.
Two synthetic client sessions exercised login, cabinet pages, nutrition,
training, generated PDFs, and assigned PDF/DOCX documents. The runs lasted ten
seconds per step, so they are a comparative laboratory signal, not a precise
measurement or forecast of production performance.

| Active users | Requests | RPS | Errors | p50 | p95 | p99 | Node CPU / RAM | PostgreSQL CPU / RAM |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 76 | 6.86 | 0% | 11 ms | 173 ms | 284 ms | 2% / 81 MiB | 5% / 150 MiB |
| 5 | 264 | 22.51 | 0% | 17 ms | 379 ms | 521 ms | 32% / 100 MiB | 1% / 159 MiB |
| 10 | 389 | 32.27 | 0% | 68 ms | 587 ms | 1,004 ms | 76% / 101 MiB | 8% / 171 MiB |
| 20 | 394 | 26.81 | 0% | 213 ms | 1,804 ms | 2,294 ms | 100% / 105 MiB | 8% / 171 MiB |
| 30 | 387 | 24.21 | 0% | 276 ms | 3,546 ms | 3,994 ms | 93% / 105 MiB | 8% / 171 MiB |
| 50 | 425 | 21.17 | 0% | 394 ms | 5,678 ms | 6,518 ms | 100% / 103 MiB | 4% / 171 MiB |

There were no container restarts or OOM events. The maximum measured step that
kept page p95 below two seconds was 20 active users. Applying 30% operating
headroom gives a conservative planning reference of **14 simultaneously active
users** on these modeled limits. CPU-bound server-side rendering and PDF/file
work is the first bottleneck; PostgreSQL and memory retained substantial
headroom. Repeat a longer test on staging with production-like network latency
and data volume before using this number for deployment capacity decisions.

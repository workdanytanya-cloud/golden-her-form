# Production video tools recovery

Recovered on 2026-10-20 from the read-only production release
`video-all-20260915140528`. Before retrieval, the complete reachable Git history
was checked, including `cursor/cloud-agent-1786272222564-dsxg8`; none of these
six paths existed in Git.

Only the six files below were read and copied. No environment files, database,
uploads, logs, dumps, cookies, keys, or client data were accessed.

| File | Purpose | Production SHA-256 | Recovered SHA-256 |
| --- | --- | --- | --- |
| `bind-local-fallbacks.py` | Bind remaining exercises from aliases or local fallback videos without changing published training snapshots. | `69e35a37875d6253f08e20ed08f08ebafbff3036b2eeb29f87e20be83c0cc9d8` | `07c584b61e42b1569f3ff91100f596da8da689fbc11e4bd86761e4e0ea3a421e` |
| `bind-media-aliases.py` | Resolve unbound exercise media through normalized names, aliases, and first-segment matches. | `a0991c4c8b42b297a7f73a7ae2dc38a0fedc9fd019015b2aee53ae63b55acadd` | `04dbf990e447a3b6fbce357052a3ab1013219eff157e6cbc0a0afc465d32a078` |
| `bind-youtube-from-names.py` | Recover YouTube/Rutube bindings from exercise names, slugs, and parsed sheet data. | `be691f3c0523599c93634db5b783cdacc036c1433c0221dfb145ce1d5ab0f615` | `b8d0dcb179817b0b2bf78f42918c1db4947a0d179029865d7bbd3a079a2a0887` |
| `import-coach-sheet-media.mjs` | Standalone Node importer for parsed coach-sheet video rows with snapshot/hash invariants. | `137eceac92da85bf40e9165f7c695e5b717efc7a8685f5559d4ab0158a6ff018` | `9cf954527cdd0821c7aa188eb0bee5f3156767a629a64e7b40472c9406bb20e6` |
| `import-coach-sheet-media.py` | Python importer for parsed coach-sheet video rows, including conflict reporting and dry-run support. | `5f94ea4e14c8cf7bf718ad7127367efd117f234aee1e8dbe6569d30ab69e8d58` | `073d34f202df52912b056904e71079f44aa182f2ed72dd2af35241f5781f7648` |
| `README-coach-sheet-media.md` | Operator notes for the coach-sheet media import workflow. | `2246863fad93a2d56c3b65828753c8394adff310d2e0df331e7958c7162928e1` | `b95a7decdc1161264916588b9662736b0794364095a3940e3a2f7b08027d9972` |

The recovered hashes differ because hard-coded production paths were removed.
Credentials now come only from `DATABASE_URL` or an explicitly supplied
`--database-url-file` / `PANOVAPRO_DATABASE_URL_FILE`. Sheet data, media roots,
and legacy assets likewise require explicit CLI arguments or documented
environment variables. The Node importer no longer probes `.env` files or a
fixed system path; it reads only files explicitly listed in
`PANOVAPRO_ENV_FILES` and `PANOVAPRO_DATABASE_URL_FILE`.

The source and recovered files were scanned for credential markers, connection
strings, email addresses, phone numbers, client UUIDs, and absolute production
paths. No secrets or personal data were found. The only findings were the
absolute operational paths described above, and the recovered files contain no
such paths.

## Verification

Run syntax-only checks without connecting to a database:

```bash
python -m py_compile \
  selfhost/cli/bind-local-fallbacks.py \
  selfhost/cli/bind-media-aliases.py \
  selfhost/cli/bind-youtube-from-names.py \
  selfhost/cli/import-coach-sheet-media.py
node --check selfhost/cli/import-coach-sheet-media.mjs
```

Every tool that can write media bindings first captures the published training
version count and aggregate content hash and verifies that these values are
unchanged after the operation.

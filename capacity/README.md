# Capacity audit

This is an isolated model environment, not a production limit. The application
container is capped at 1 CPU and 2 GiB RAM and runs one Node worker. PostgreSQL
and Nginx are separate containers; k6 runs in a separate load-generator
container. Fixtures contain two synthetic clients only.

Run `docker compose -f docker-compose.capacity.yml up -d --build`, upload and
publish one synthetic PDF and DOCX through the admin UI, then run each level
from a shell separate from the app container:

```powershell
1,5,10,20,30,50 | ForEach-Object {
  $env:VUS=$_
  docker compose -f docker-compose.capacity.yml --profile load run --rm loadgen
  docker stats --no-stream
  docker compose -f docker-compose.capacity.yml exec postgres psql -U panovapro -d panovapro -c "select count(*) as postgres_connections from pg_stat_activity;"
}
```

The k6 summaries contain RPS, p50/p95/p99 and errors. Capture `docker stats`,
Node heap/event-loop telemetry, PostgreSQL connections, and container restart
counts at every level. Stop increasing concurrency when errors reach 1%, normal
page p95 exceeds 2 seconds, file/PDF p95 exceeds 5 seconds, an OOM/restart
occurs, or the PostgreSQL pool is exhausted. Repeat with app limits 2 CPU/4 GiB
and 4 CPU/8 GiB. Do not translate model results into registered-client counts
without an explicitly measured visits-per-client assumption.

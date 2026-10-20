# Coach sheet → exercise_media_bindings

Источник: https://docs.google.com/spreadsheets/d/1SU_RzbakfsSb5UAb7u1JO0yvib3GI8rPQa3E4_5Xa3g

## Повтор после sync production-данных

На VDS (не печатает DATABASE_URL):

```bash
# при обновлении таблицы: скачать XLSX локально, распарсить, залить data/
export PANOVAPRO_DATABASE_URL_FILE=/path/to/protected/database.url
python3 selfhost/cli/import-coach-sheet-media.py \
  --input=/path/to/parsed-sheet-rows.json
```

Локально обновить JSON из XLSX:

```bash
node scripts/_parse-coach-xlsx.mjs _tmp-exercise-videos/coach-exercises.xlsx
```

Идемпотентно (ON CONFLICT upsert). Не меняет published snapshots / content_hash.

# Nutrition constructor — полный прогон

Обезличенный отчёт (без локальных путей и PII).

## Первопричина кейса 1726

1. **Генератор:** эвристика Top-N/штрафы трио смещали рацион в жир при низкой F49.5 / высокой C221.2 → near-miss показывался как «невозможно».
2. **Publish E2E:** `nutrition_plans.target_*` были `integer` + `roundTargetsForDb` → `49.5` становилось `50`, дни (собранные под 49.5) падали на publish. Исправлено миграцией `020_nutrition_decimal_targets.sql` и округлением до 1 знака.

## Обязательные якоря

| Кейс | Результат |
|------|-----------|
| 1726 / P99 / F49.5 / C221.2 / `three_mains_only` / 7д | **PASS** (regression anchor) |
| 1313 / `two_main_two_snacks` / 28д | **PASS** (~71 с; max Δkcal≈1.2, ΔБЖУ&lt;1) |
| 1800 / `two_main_two_snacks` / 28д | **PASS** (~51 с) |

### 1726 по дням (пример прогона)

Цикл week-tile; макросы в допусках ±5 ккал / ±1 г. Seeds `1/42/1726` воспроизводимы на 1д.

## Матрица 7×4 (1 день, seed=17260917)

Итог: **PASS 21 / INFEASIBLE 3 / TIMEOUT 4** (всего 28).

Неудачные (не скрыты):

| kcal | mode | status |
|------|------|--------|
| 1200 | three_main_two_snacks | INFEASIBLE (после fallback) |
| 1500 | three_main_two_snacks | TIMEOUT |
| 1726 | three_main_two_snacks | TIMEOUT |
| 1313 | one_main_three_snacks | TIMEOUT |
| 1726 | one_main_three_snacks | TIMEOUT |
| 2000 | one_main_three_snacks | INFEASIBLE |
| 2200 | one_main_three_snacks | INFEASIBLE |

1726 × `three_mains_only`: **PASS** (fast_topn, ~12 с).

Детали: `docs/nutrition-matrix-results.json`.

## Fuzz (≥100 cases, seed base 424242)

`PASS: 30`, `TIMEOUT: 56`, `INFEASIBLE: 14`, `ERROR: 0` (total 100).  
NaN/crash/partial days: нет. Near-miss не в `days`.

Детали: `docs/nutrition-fuzz-results.json`.

## Negative codes

| Сценарий | Код |
|----------|-----|
| kcal ⟂ БЖУ | INVALID_TARGET |
| все белки исключены | NO_ALLOWED_PRODUCTS |
| короткий лимит | TIMEOUT (не INFEASIBLE) |
| force throw | INTERNAL_ERROR |
| force_top_n=3 за пределами Top-N | PASS через exact fallback |

## Performance (sequential, 1 worker)

| metric | ms |
|--------|-----|
| median | 25629 |
| p95 | 94907 |
| max | 94907 (1726×7д) |
| fast median | 12322 |
| fallback median | 11697 |

UI: блокировка двойного запуска (`if (loading) return`), код/этап поиска, near-miss не пишет draft.

## Postgres E2E 1726

`generate → draft → reopen → publish → idempotent retry → client → PDF` — **ALL PASS**.  
После мутации каталога `content_hash`/snapshot неизменны. Supabase-запросов нет. INVALID_TARGET не даёт days.

## Immutable safety

Правки генератора/миграции целей не пересобирают published snapshots и не меняют `content_hash` клиентов без новой публикации тренером.

## Бывшие «33 падения»

Исторический блокер этапа draft/publish. Текущий контур: якоря 1313/28, 1800/28, 1726/7 зелёные; negative/matrix/fuzz отдают коды без crash. Отдельные TIMEOUT/INFEASIBLE в матрице/`one_main` — честные исходы каталога, не silent near-miss.

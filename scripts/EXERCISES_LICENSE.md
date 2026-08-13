# Источники упражнений

## Текущая библиотека (основная)

- **Таблица тренера (Panova)** — названия и видео YouTube/Rutube из вашей Google Sheet.
- Импорт: `npm run exercises:import-sheet` → `npm run exercises:apply-seed`
- На сайте показывается только содержимое (упражнения + видео), не сама таблица.

## Что удалено / не используем

| Источник | Почему |
|---|---|
| exercises-dataset / LogPress (MIT text) | Машинный перевод («тросовый ряд» и т.п.) — новичок не поймёт |
| ExerciseDB / AscendAPI free | Non-commercial без платного RapidAPI |
| Open ExerciseDB (MIT) | То же: чужие названия + чужие медиа |
| GIF из exercises-dataset | © Gym visual, не покрыто MIT |

Очистка кривых переводов: `npm run exercises:purge-bad-ru`

## Медиа на сайте

Видео берутся из таблицы тренера. Дополнительно можно загрузить вручную в админке.

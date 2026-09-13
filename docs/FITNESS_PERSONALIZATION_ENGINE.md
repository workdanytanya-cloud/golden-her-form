# Движок персонализации программ

Спецификация поведения AI + rule-based движка для платформы персонального тренера.

## Принцип реализации

| Задача | Кто делает |
|--------|------------|
| BMR/TDEE, калории, БЖУ, порции | **Код** — `src/lib/nutrition.ts`, `src/lib/personalization/macro-math.ts` |
| Выбор упражнений/блюд из БД | **Код** — `generateProgram`, `generatePlan` |
| Safety gate, валидация | **Код** — `src/lib/personalization/` |
| Адаптация по check-in / RPE | **Код** — `adaptation-engine.ts` (правила) |
| Стратегия, формулировки, объяснения | **LLM** (будущий слой; не заменяет тренера) |

**LLM не считает калории и не придумывает `exercise_id`.**

## Модули

```
src/lib/personalization/
  types.ts              — типы профиля, safety, backend payload
  client-profile.ts     — CLIENT_PROFILE из анкеты
  safety-gate.ts        — requires_trainer_review / medical clearance
  equipment-filter.ts   — фильтр упражнений по инвентарю
  program-validation.ts — FINAL VALIDATION перед сохранением
  macro-math.ts         — 4P+4C+9F ≈ kcal
  adaptation-engine.ts  — KEEP / PROGRESS / REDUCE / …
  index.ts
```

Точки входа:
- `src/lib/onboarding-autogen.ts` — черновики после анкеты
- `src/lib/training.ts` — генерация тренировок (только упражнения из БД)
- `src/lib/nutrition.ts` — генерация питания (только блюда из БД)

## Safety gate

При беременности, недавней операции, серьёзных ограничениях, выраженной боли, РПП и т.п.:

- `requires_trainer_review = true`
- при необходимости `requires_medical_clearance = true`
- клиенту — нейтральное сообщение без диагнозов
- автопрограмма не выдаётся как финальная без проверки тренера

## Персонализация (обязательно)

Программы двух разных клиентов должны отличаться, если отличаются:

цель × возраст × опыт × вес × активность × расписание × оборудование × предпочтения × ограничения × сон × реакция на прошлую программу.

## Прогрессия и первые 14–21 день

- Неделя 1: адаптация + калибровка
- Неделя 2: закрепление + осторожная прогрессия
- Неделя 3: персонализация по фактическим данным

Прогрессия — по выполнению (RPE, объём, техника), не по календарю.

## Приоритет тренера

`targets_manual = true` блокирует автоперезапись. Любое ручное решение тренера важнее AI.

## Backend payload (структура)

См. тип `BackendProgramPayload` в `src/lib/personalization/types.ts`.

Метаданные генерации сохраняются в `onboarding_responses.extra.generation_meta`.

## Что ещё не реализовано

- [x] UI weekly check-in + workout feedback
- [x] Автопрогрессия по RPE (±1 подход / отдых, без изменений при `targets_manual`)
- [x] LLM SUBSTITUTE (только exercise_id из БД; fallback — rules)
- [x] Конструктор питания A/B/C в UI
- [ ] `focus_areas` и `session_duration` в scoring упражнений

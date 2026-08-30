/** Флаги защиты опубликованных программ. Деплой/seed не перегенерируют назначения. */

/** Запрет автопересборки назначенных программ при деплое. */
export const AUTO_REGENERATE_ON_DEPLOY = false;

/** Seed каталога не трогает client_program_assignments / *_versions. */
export const SEED_TOUCHES_CLIENT_ASSIGNMENTS = false;

export const CLIENT_MEASUREMENT_SAVED_MESSAGE =
  "Данные сохранены и переданы тренеру. Текущая программа продолжает действовать до проверки и назначения корректировки";

export const CLIENT_NUTRITION_UPDATED_MESSAGE =
  "Тренер обновил вашу программу питания с учётом текущего прогресса";

export const PUBLISHED_IMMUTABLE_ERROR =
  "Опубликованную версию нельзя изменять напрямую. Создайте новую версию.";

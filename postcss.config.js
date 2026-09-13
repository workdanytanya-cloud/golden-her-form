// Локальный пустой PostCSS, чтобы Vite не подхватывал postcss.config.js
// из родительской папки (там Tailwind v3 ломает сборку этого проекта).
export default {
  plugins: {},
};

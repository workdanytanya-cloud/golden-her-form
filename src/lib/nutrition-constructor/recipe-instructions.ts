import { repairRecipeName, technicalNameReason } from "@/lib/nutrition-constructor/recipe-names";
import type { FoodProduct, Recipe, RecipeIngredient } from "@/lib/nutrition-constructor/types";

export type InstructionKind =
  | "porridge"
  | "overnight_oats"
  | "omelette"
  | "boiled_grain"
  | "baked_meat"
  | "stewed_meat"
  | "baked_fish"
  | "soup"
  | "salad"
  | "sandwich"
  | "wrap"
  | "cottage_cheese_bowl"
  | "yogurt_bowl"
  | "smoothie"
  | "no_cook_snack";

export type InstructionIngredient = {
  slug: string;
  name: string;
  required?: boolean;
  category?: string | null;
  state?: string | null;
  requiresCooking?: boolean;
};

export type InstructionInput = {
  name: string;
  requiresCooking: boolean;
  cookingMethod?: string | null;
  mealType?: "main" | "snack" | null;
  storageNotes?: string | null;
  ingredients: InstructionIngredient[];
};

const GRAIN_SLUGS = new Set([
  "oats-dry",
  "rice-white-dry",
  "buckwheat-dry",
  "bulgur-dry",
  "couscous-dry",
  "pearl-barley-dry",
  "lentils-dry",
  "pasta-durum-dry",
]);

const RAW_MEAT = new Set([
  "chicken-breast-raw",
  "chicken-thigh-raw",
  "beef-lean-raw",
  "turkey-breast-raw",
  "ground-turkey-raw",
]);

const RAW_FISH = new Set(["pollock-raw", "cod-raw", "hake-raw", "pink-salmon-raw"]);

function isOats(item: InstructionIngredient): boolean {
  return item.slug === "oats-dry" || item.slug.includes("oats");
}

function isGrain(item: InstructionIngredient): boolean {
  return item.category === "grain" || GRAIN_SLUGS.has(item.slug) || isOats(item);
}

function isRawMeat(item: InstructionIngredient): boolean {
  return RAW_MEAT.has(item.slug) || (item.category === "meat" && item.state === "raw");
}

function isRawFish(item: InstructionIngredient): boolean {
  return (
    RAW_FISH.has(item.slug) ||
    (item.category === "fish" && item.state !== "canned_drained" && item.state !== "ready")
  );
}

function isPotato(item: InstructionIngredient): boolean {
  return item.slug === "potato-raw";
}

function isWholeEgg(item: InstructionIngredient): boolean {
  return !isEggWhite(item) && (item.slug === "egg-whole" || item.slug.includes("egg"));
}

function isEggWhite(item: InstructionIngredient): boolean {
  return item.slug.includes("egg-white");
}

function isOil(item: InstructionIngredient): boolean {
  return item.category === "fat" || /oil|butter/.test(item.slug);
}

function isLiquidDairy(item: InstructionIngredient): boolean {
  return /milk|kefir|yogurt/.test(item.slug);
}

function isCottage(item: InstructionIngredient): boolean {
  return item.slug.includes("cottage-cheese");
}

function isYogurt(item: InstructionIngredient): boolean {
  return /yogurt|kefir/.test(item.slug);
}

function isBread(item: InstructionIngredient): boolean {
  return /bread/.test(item.slug);
}

function isWrap(item: InstructionIngredient): boolean {
  return /lavash|tortilla|wrap/.test(item.slug);
}

function isReady(item: InstructionIngredient): boolean {
  return (
    item.state === "ready" ||
    item.state === "canned_drained" ||
    item.category === "canned" ||
    item.requiresCooking === false
  );
}

function joinNames(names: string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  return `${unique.slice(0, -1).join(", ")} и ${unique[unique.length - 1]}`;
}

function grainSentence(item: InstructionIngredient): string {
  if (isOats(item)) {
    return "Отмерьте сухие овсяные хлопья по рациону, залейте водой и варите на слабом огне до мягкости.";
  }
  if (item.slug.includes("rice"))
    return `Промойте ${item.name.toLowerCase()} и отварите до готовности.`;
  if (item.slug.includes("buckwheat") || /греч/i.test(item.name)) {
    return "Гречку промыть и отварить до готовности.";
  }
  if (item.slug.includes("pasta")) return `Отварите ${item.name.toLowerCase()} до готовности.`;
  if (item.slug.includes("couscous"))
    return `Залейте ${item.name.toLowerCase()} кипятком и доведите до готовности.`;
  return `Доведите до готовности ${item.name.toLowerCase()} по типу крупы.`;
}

export function classifyInstruction(input: InstructionInput): InstructionKind {
  const items = input.ingredients;
  const oats = items.some(isOats);
  const grains = items.some(isGrain);
  const meat = items.some(isRawMeat);
  const fish = items.some(isRawFish);
  const potato = items.some(isPotato);
  const method = input.cookingMethod ?? "";
  const liquid = items.some(isLiquidDairy);
  if (method === "soup") return "soup";
  if (oats && liquid && !meat && !fish && !potato && !input.requiresCooking)
    return "overnight_oats";
  if (oats && !meat && !fish) return "porridge";
  if (grains && !meat && !fish) return "boiled_grain";
  if (fish) return "baked_fish";
  if (meat && (method === "bake" || method === "oven")) return "baked_meat";
  if (meat) return "stewed_meat";
  if (items.some(isWholeEgg) && !grains && !potato) return "omelette";
  if (items.some(isWrap)) return "wrap";
  if (items.some(isBread)) return "sandwich";
  if (items.some(isCottage) && !input.requiresCooking) return "cottage_cheese_bowl";
  if (items.some(isYogurt) && !input.requiresCooking) return "yogurt_bowl";
  if (/смузи/i.test(input.name)) return "smoothie";
  if (!input.requiresCooking && input.mealType === "snack") return "no_cook_snack";
  if (!input.requiresCooking) return "salad";
  if (potato) return "baked_meat";
  return input.mealType === "snack" ? "no_cook_snack" : "stewed_meat";
}

function mentionMissing(steps: string[], items: InstructionIngredient[]): string[] {
  const mentioned = steps.join(" ").toLowerCase();
  const missingNames = items
    .filter((item) => {
      const token = item.name.toLowerCase().slice(0, 5);
      return token.length >= 4 && !mentioned.includes(token) && !isOil(item);
    })
    .map((item) => item.name.toLowerCase());
  if (missingNames.length === 0) return steps;
  const next = [...steps];
  const line = `Используйте из состава: ${missingNames.join(", ")}.`;
  if (next.length < 7) next.push(line);
  else next[next.length - 1] = `${next[next.length - 1]} ${line}`;
  return next;
}

export function composeRecipeSteps(input: InstructionInput): {
  kind: InstructionKind;
  steps: string[];
} {
  const slugs = new Set(input.ingredients.map((item) => item.slug));
  if (
    slugs.has("chicken-breast-raw") &&
    slugs.has("buckwheat-dry") &&
    slugs.has("cucumber") &&
    slugs.has("bell-pepper")
  ) {
    const steps = [
      "Гречку промыть и отварить до готовности.",
      "Курицу — куриную грудку — нарезать и приготовить на сковороде, потушить или запечь без сильной обжарки.",
      "Огурец и болгарский перец нарезать.",
      "Подайте курицу с гречкой и свежими овощами.",
    ];
    if ([...slugs].some((slug) => /oil|butter/.test(slug))) {
      steps.push("Указанное количество масла добавить к овощам или готовому блюду.");
    }
    return { kind: "stewed_meat", steps: mentionMissing(steps, input.ingredients) };
  }
  const kind = classifyInstruction(input);
  const items = input.ingredients.filter((item) => item.name.trim());
  const grains = items.filter(isGrain);
  const meats = items.filter(isRawMeat);
  const fish = items.filter(isRawFish);
  const eggs = items.filter(isWholeEgg);
  const whites = items.filter(isEggWhite);
  const oils = items.filter(isOil);
  const potatoes = items.filter(isPotato);
  const liquids = items.filter(isLiquidDairy);
  const mentioned = new Set<string>();
  const mark = (list: InstructionIngredient[]) => {
    for (const item of list) mentioned.add(item.slug);
  };
  const steps: string[] = [];

  if (kind === "overnight_oats") {
    mark(grains);
    mark(liquids);
    steps.push(
      `Смешайте ${joinNames(grains.map((item) => item.name.toLowerCase()))} с ${joinNames(liquids.map((item) => item.name.toLowerCase()))}.`,
    );
    steps.push("Уберите смесь в холодильник минимум на 4 часа.");
  } else if (grains.length > 0) {
    mark(grains);
    steps.push(grains.map(grainSentence).join(" "));
    if (liquids.length > 0 && grains.some(isOats)) {
      mark(liquids);
      steps.push(
        `Жидкость для каши — ${joinNames(liquids.map((item) => item.name.toLowerCase()))} из состава.`,
      );
    }
  }

  if (fish.length > 0) {
    mark(fish);
    steps.push(
      `Запеките или отварите ${joinNames(fish.map((item) => item.name.toLowerCase()))} до полной готовности.`,
    );
  }
  if (meats.length > 0) {
    mark(meats);
    const chicken = meats.some((item) => item.slug.includes("chicken"));
    steps.push(
      chicken
        ? "Курицу — куриную грудку — нарезать и приготовить на сковороде, потушить или запечь без сильной обжарки."
        : kind === "baked_meat"
          ? `Запеките ${joinNames(meats.map((item) => item.name.toLowerCase()))} до полной готовности, без сырой середины.`
          : `Тушите ${joinNames(meats.map((item) => item.name.toLowerCase()))} до полной готовности, без сырой середины.`,
    );
  }
  if (potatoes.length > 0 && !grains.some(isPotato)) {
    mark(potatoes);
    steps.push(
      `Отварите или запеките ${joinNames(potatoes.map((item) => item.name.toLowerCase()))} до мягкости.`,
    );
  }
  if (eggs.length > 0) {
    mark(eggs);
    steps.push(
      kind === "omelette"
        ? `Взбейте ${joinNames(eggs.map((item) => item.name.toLowerCase()))} и готовьте до готовности, без жидкого белка.`
        : `Отварите ${joinNames(eggs.map((item) => item.name.toLowerCase()))} до готовности и добавьте в блюдо.`,
    );
  }
  if (whites.length > 0) {
    mark(whites);
    steps.push(
      `Прогрейте ${joinNames(whites.map((item) => item.name.toLowerCase()))} в горячем блюде до готовности. Сырой белок не подавать.`,
    );
  }

  const rest = items.filter((item) => !mentioned.has(item.slug) && !isOil(item));
  if (rest.length > 0) {
    mark(rest);
    steps.push(`Добавьте из состава: ${joinNames(rest.map((item) => item.name.toLowerCase()))}.`);
  }
  if (oils.length > 0) {
    mark(oils);
    steps.push("Указанное количество масла добавить к овощам или готовому блюду.");
  }
  steps.push(
    kind === "overnight_oats"
      ? "Перед подачей перемешайте и подайте охлаждённым."
      : "Соберите блюдо и сразу подайте.",
  );
  const storage = input.storageNotes?.trim();
  if (storage && steps.length < 7) steps.push(`Хранение: ${storage}`);

  const compact = steps.map((step) => step.replace(/\s+/g, " ").trim()).filter(Boolean);
  while (compact.length > 7) {
    const extra = compact.splice(1, 1)[0];
    if (extra) compact[0] = `${compact[0]} ${extra}`;
  }
  while (compact.length < 3) {
    compact.splice(compact.length - 1, 0, "Подготовьте продукты строго из списка ингредиентов.");
  }
  const mentionedText = compact.join(" ").toLowerCase();
  const missingNames = items
    .filter((item) => {
      const token = item.name.toLowerCase().slice(0, 5);
      return token.length >= 4 && !mentionedText.includes(token) && !isOil(item);
    })
    .map((item) => item.name.toLowerCase());
  if (missingNames.length > 0) {
    const line = `Используйте из состава: ${missingNames.join(", ")}.`;
    if (compact.length < 7) compact.push(line);
    else compact[compact.length - 1] = `${compact[compact.length - 1]} ${line}`;
  }
  return { kind, steps: compact.slice(0, 7) };
}

const ABSENT_WORD: Array<{ pattern: RegExp; slug: RegExp; name: RegExp }> = [
  { pattern: /молок/i, slug: /milk/, name: /молок/i },
  { pattern: /йогурт/i, slug: /yogurt/, name: /йогурт/i },
  { pattern: /кефир/i, slug: /kefir/, name: /кефир/i },
  { pattern: /банан/i, slug: /banana/, name: /банан/i },
  { pattern: /яблок/i, slug: /apple/, name: /яблок/i },
  { pattern: /рис/i, slug: /rice/, name: /рис/i },
  { pattern: /греч/i, slug: /buckwheat/, name: /греч/i },
  { pattern: /овсян/i, slug: /oats/, name: /овсян/i },
  { pattern: /куриц/i, slug: /chicken/, name: /куриц/i },
  { pattern: /индей/i, slug: /turkey/, name: /индей/i },
  { pattern: /говяд/i, slug: /beef/, name: /говяд/i },
  { pattern: /картоф/i, slug: /potato/, name: /картоф/i },
];

export function validateRecipeInstruction(input: InstructionInput & { steps: string[] }): string[] {
  const issues: string[] = [];
  const text = input.steps.join(" ");
  const lower = text.toLowerCase();
  if (input.steps.length < 3 || input.steps.length > 7) issues.push("steps-count");
  if (!/подайте|соберите/i.test(text)) issues.push("no-finish");
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text) || /recipe_id|variant_group/i.test(text)) {
    issues.push("technical");
  }
  const grains = input.ingredients.filter(isGrain);
  const oats = input.ingredients.some(isOats);
  if (grains.length > 0 && /без крупы/i.test(lower)) issues.push("grain-removed");
  if (oats && !/вар|залей|смешайте|холодильник/i.test(lower)) issues.push("oats-unprepared");
  if (grains.length > 0 && !/вар|залей|готовност|мягкост|кипят|смешайте|холодильник/i.test(lower)) {
    issues.push("grain-unprepared");
  }
  const rawHeat = input.ingredients.filter(
    (item) =>
      isRawMeat(item) || isRawFish(item) || isPotato(item) || isWholeEgg(item) || isEggWhite(item),
  );
  if (rawHeat.length > 0 && !/готовност|туш|запек|прогре|варит|отвар/i.test(lower)) {
    issues.push("raw-unprepared");
  }
  if (
    !input.requiresCooking &&
    rawHeat.length > 0 &&
    !/готовност|отвар|запек|туш|прогре|варит/i.test(lower)
  ) {
    issues.push("no-cook-raw");
  }
  if (input.ingredients.some(isOil) && !/масл/i.test(lower)) issues.push("oil-missing");
  if (/овсян/i.test(input.name) && !oats) issues.push("name-without-oats");
  const ignored = new Set(["water", "salt", "black-pepper", "dried-herbs"]);
  for (const item of input.ingredients.filter(
    (row) => row.required !== false && !ignored.has(row.slug) && !isOil(row),
  )) {
    const token = item.name.toLowerCase().slice(0, 5);
    if (token.length >= 4 && !lower.includes(token)) issues.push(`missing:${item.slug}`);
  }
  for (const rule of ABSENT_WORD) {
    if (
      rule.pattern.test(lower) &&
      !input.ingredients.some((item) => rule.slug.test(item.slug) || rule.name.test(item.name))
    ) {
      issues.push(`absent:${rule.pattern.source}`);
    }
  }
  return issues;
}

export type CatalogFixCounts = { names: number; instructions: number };

export let lastCatalogFix: CatalogFixCounts = { names: 0, instructions: 0 };

export function canonicalizeRecipes(
  recipes: Recipe[],
  ingredients: Map<string, RecipeIngredient[]>,
  products: Map<string, FoodProduct>,
): CatalogFixCounts {
  let names = 0;
  let instructions = 0;
  lastCatalogFix = { names: 0, instructions: 0 };
  for (const recipe of recipes) {
    const lines = ingredients.get(recipe.id) ?? [];
    const inputIngredients: InstructionIngredient[] = [];
    for (const line of lines) {
      const product = products.get(line.product_id);
      if (!product) continue;
      inputIngredients.push({
        slug: product.slug,
        name: product.name,
        required: line.optional !== true,
        category: product.category,
        state: product.state,
        requiresCooking: product.requires_cooking,
      });
    }
    const nextName = repairRecipeName(recipe.name);
    if (nextName !== recipe.name) {
      recipe.name = nextName;
      names += 1;
    }
    if (technicalNameReason(recipe.name)) recipe.dietitian_approved = false;
    const composed = composeRecipeSteps({
      name: recipe.name,
      requiresCooking: recipe.requires_cooking,
      cookingMethod: recipe.cooking_method,
      mealType: recipe.meal_type,
      storageNotes: recipe.storage_notes,
      ingredients: inputIngredients,
    });
    if (recipe.steps.join("\n") !== composed.steps.join("\n")) {
      recipe.steps = composed.steps;
      instructions += 1;
    }
    const issues = validateRecipeInstruction({
      name: recipe.name,
      requiresCooking: recipe.requires_cooking,
      cookingMethod: recipe.cooking_method,
      mealType: recipe.meal_type,
      ingredients: inputIngredients,
      steps: recipe.steps,
    });
    if (issues.length > 0) recipe.dietitian_approved = false;
  }
  lastCatalogFix = { names, instructions };
  return { names, instructions };
}

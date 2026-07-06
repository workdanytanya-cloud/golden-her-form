import { useState } from "react";
import { ChevronDown, Coffee, Info } from "lucide-react";

type Row = { product: string; raw: string; cooked: string; note: string };
type Section = {
  id: string;
  title: string;
  subtitle: string;
  accent: string; // tailwind gradient classes
  rows: Row[];
  footer?: string;
};

const SECTIONS: Section[] = [
  {
    id: "principles",
    title: "Как читать сырой и готовый вес",
    subtitle: "База — без путаницы",
    accent: "from-pink-500/20 to-transparent",
    rows: [
      {
        product: "1. Смотрим, в каком весе дан продукт",
        raw: "—",
        cooked: "—",
        note: "На сайте список дан в сыром весе. Исключения — пометки «варёная», «готовый продукт», «сухой продукт», «штуки».",
      },
      {
        product: "2. Крупы и макароны",
        raw: "сухой",
        cooked: "готовый",
        note: "Взвешиваем сухими. После варки: рис ≈ ×3, гречка ≈ ×2,5, макароны ≈ ×2,3–2,5.",
      },
      {
        product: "3. Мясо и рыба",
        raw: "сырой",
        cooked: "готовый",
        note: "Взвешиваем сырыми. После готовки: мясо −25–35%, рыба −15–25%.",
      },
      {
        product: "4. Творог, йогурт, хлеб, фрукты, сыр, орехи",
        raw: "готовый",
        cooked: "готовый",
        note: "Это уже готовый вес — ничего пересчитывать не нужно.",
      },
      {
        product: "5. Главный принцип",
        raw: "—",
        cooked: "—",
        note: "Если меню считает сырой продукт — взвешиваем сырой. Если уже приготовили — используем таблицу пересчёта.",
      },
      {
        product: "6. Без фанатизма",
        raw: "—",
        cooked: "—",
        note: "Идеальной точности в готовом весе нет: вода, способ готовки и прожарка меняют цифры. Используем понятные рабочие ориентиры.",
      },
    ],
    footer:
      "Точность даёт не «магическая таблица», а одинаковый способ взвешивания изо дня в день.",
  },
  {
    id: "protein-1",
    title: "Белки: мясо, птица, рыба",
    subtitle: "вес по списку → ориентир после приготовления",
    accent: "from-rose-500/25 to-transparent",
    rows: [
      { product: "Филе индейки", raw: "100 г", cooked: "≈ 70–75 г", note: "варка/запекание/тушение обычно −25–30%" },
      { product: "Телятина", raw: "100 г", cooked: "≈ 65–75 г", note: "зависит от куска и способа приготовления" },
      { product: "Конина", raw: "100 г", cooked: "≈ 65–75 г", note: "зависит от куска и способа приготовления" },
      { product: "Яичный белок", raw: "9 шт", cooked: "≈ 245–270 г готового белка", note: "1 белок ≈ 30–33 г; если белок из бутылки — взвешивайте сырой" },
      { product: "Греческий йогурт / йогурт без добавок", raw: "300 г", cooked: "300 г", note: "не готовим" },
      { product: "Творог 5%", raw: "150 г", cooked: "150 г", note: "не готовим" },
      { product: "Сывороточный протеин", raw: "30 г", cooked: "30 г", note: "готовый порошок" },
      { product: "Казеиновый протеин", raw: "30 г", cooked: "30 г", note: "готовый порошок" },
      { product: "Анчоусы", raw: "100 г", cooked: "100 г готовых или ≈ 80 г после готовки", note: "чаще используются готовые/консервированные" },
      { product: "Сардины", raw: "100 г", cooked: "100 г готовых или ≈ 80 г после готовки", note: "чаще консервированные, уже готовы" },
      { product: "Тилапия", raw: "110 г", cooked: "≈ 90 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Минтай", raw: "140 г", cooked: "≈ 115 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Горбуша", raw: "110 г", cooked: "≈ 90 г", note: "рыба обычно −15–20%" },
      { product: "Пикша", raw: "140 г", cooked: "≈ 115 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Хек", raw: "130 г", cooked: "≈ 105 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Треска", raw: "130 г", cooked: "≈ 105 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Окунь", raw: "130 г", cooked: "≈ 105 г", note: "нежирная рыба обычно −15–20%" },
      { product: "Зубатка", raw: "100 г", cooked: "≈ 80 г", note: "рыба обычно −15–20%" },
    ],
    footer:
      "Для мяса и рыбы готовый вес всегда зависит от способа: тушение мягче, гриль/духовка сушат сильнее.",
  },
  {
    id: "protein-2",
    title: "Белки: рыба, морепродукты, веган",
    subtitle: "вес по списку → готовый вес",
    accent: "from-sky-500/25 to-transparent",
    rows: [
      { product: "Сёмга", raw: "100 г", cooked: "≈ 80 г", note: "жирная рыба обычно −15–20%" },
      { product: "Тунец", raw: "100 г", cooked: "100 г готового или ≈ 80 г после готовки", note: "консервированный тунец считаем как готовый" },
      { product: "Палтус", raw: "130 г", cooked: "≈ 105 г", note: "рыба обычно −15–20%" },
      { product: "Осьминог", raw: "130 г", cooked: "≈ 90 г", note: "при варке может ужиматься сильнее" },
      { product: "Креветки", raw: "100 г", cooked: "≈ 75–80 г", note: "если уже варёные очищенные — считать как готовый вес" },
      { product: "Нерка", raw: "100 г", cooked: "≈ 80 г", note: "рыба обычно −15–20%" },
      { product: "Вяленые виды мяса", raw: "100 г", cooked: "100 г", note: "очень концентрированный продукт, смотрите соль" },
      { product: "Вяленые виды рыбы", raw: "130 г", cooked: "130 г", note: "очень концентрированный продукт, смотрите соль" },
      { product: "Мидии без раковин", raw: "130 г", cooked: "130 г готовых или ≈ 95–100 г после готовки", note: "если замороженные уже варёные — это готовый вес" },
      { product: "Тофу твёрдый", raw: "100 г", cooked: "100 г", note: "можно есть готовым/обжарить, вес почти не меняем" },
      { product: "Темпе", raw: "110 г", cooked: "110 г", note: "вес почти не меняем" },
      { product: "Сейтан", raw: "120 г", cooked: "120 г", note: "вес почти не меняем" },
      { product: "Чечевица варёная", raw: "130 г", cooked: "130 г", note: "в списке уже варёный вес" },
      { product: "Фасоль варёная", raw: "140 г", cooked: "140 г", note: "в списке уже варёный вес" },
      { product: "Куриное филе", raw: "80 г", cooked: "≈ 55–60 г", note: "готовый вес зависит от способа" },
      { product: "Филе индейки", raw: "100 г", cooked: "≈ 70–75 г", note: "готовый вес зависит от способа" },
      { product: "Греческий йогурт", raw: "250 г", cooked: "250 г", note: "не готовим" },
      { product: "Яичный белок", raw: "7 шт", cooked: "≈ 190–210 г готового белка", note: "1 белок ≈ 30–33 г; если из бутылки — взвешивайте сырой" },
    ],
    footer: "Консервы, творог, йогурт, протеин, вяленые продукты и варёные бобовые считаем как готовый вес.",
  },
  {
    id: "grains",
    title: "Крупы и гарниры",
    subtitle: "сухой вес → готовый вес после варки",
    accent: "from-emerald-500/25 to-transparent",
    rows: [
      { product: "Рис басмати", raw: "90 г", cooked: "≈ 270 г", note: "рис после варки обычно ×3" },
      { product: "Рис бурый", raw: "90 г", cooked: "≈ 270 г", note: "рис после варки обычно ×3" },
      { product: "Рис дикий/чёрный", raw: "180 г", cooked: "≈ 500–540 г", note: "цифра из списка крупная — проверьте под свою калорийность" },
      { product: "Рис белый", raw: "85 г", cooked: "≈ 255 г", note: "рис после варки обычно ×3" },
      { product: "Макароны", raw: "95 г", cooked: "≈ 220–240 г", note: "макароны после варки обычно ×2,3–2,5" },
      { product: "Киноа", raw: "110 г", cooked: "≈ 330 г", note: "киноа после варки обычно ×3" },
      { product: "Кус-кус", raw: "90 г", cooked: "≈ 220–225 г", note: "после запаривания обычно ×2,5" },
      { product: "Перловая крупа", raw: "80 г", cooked: "≈ 240 г", note: "перловка после варки обычно ×3" },
      { product: "Хлеб цельнозерновой", raw: "150 г", cooked: "150 г", note: "не готовим" },
      { product: "Картофель", raw: "400 г", cooked: "≈ 340–380 г", note: "сильно зависит от варки/запекания и кожуры" },
      { product: "Овсянка", raw: "100 г", cooked: "≈ 250–300 г каши", note: "зависит от количества воды" },
      { product: "Ячневая крупа", raw: "100 г", cooked: "≈ 300 г", note: "после варки обычно ×3" },
      { product: "Кукурузная крупа", raw: "80 г", cooked: "≈ 240 г", note: "после варки обычно ×3" },
      { product: "Пшённая крупа", raw: "90 г", cooked: "≈ 270 г", note: "после варки обычно ×3" },
      { product: "Гречка", raw: "110 г", cooked: "≈ 275 г", note: "гречка после варки обычно ×2,5" },
    ],
    footer: "Крупы и макароны почти всегда взвешиваем сухими. Готовый вес меняется от количества воды.",
  },
  {
    id: "fats",
    title: "Жиры",
    subtitle: "орехи, паста, масло, сыр, авокадо",
    accent: "from-amber-500/25 to-transparent",
    rows: [
      { product: "Семечки любые", raw: "40 г", cooked: "40 г", note: "не готовим" },
      { product: "Арахисовая паста", raw: "40 г", cooked: "40 г", note: "не готовим" },
      { product: "Авокадо", raw: "100 г", cooked: "100 г", note: "не готовим" },
      { product: "Сыр", raw: "70 г", cooked: "70 г", note: "не готовим" },
      { product: "Масло", raw: "20 г/мл", cooked: "20 г/мл", note: "лучше отмерять ложкой или на весах" },
      { product: "Сыр (порция крупнее)", raw: "65 г", cooked: "65 г", note: "не готовим" },
      { product: "Масло (порция крупнее)", raw: "25 г/мл", cooked: "25 г/мл", note: "лучше отмерять ложкой или на весах" },
      { product: "Орехи любые", raw: "40 г", cooked: "40 г", note: "не готовим" },
      { product: "Авокадо (крупная порция)", raw: "150 г", cooked: "150 г", note: "не готовим" },
      { product: "Орехи любые (крупная порция)", raw: "60 г", cooked: "60 г", note: "не готовим" },
      { product: "Арахисовая паста (крупная порция)", raw: "60 г", cooked: "60 г", note: "не готовим" },
      { product: "Масло (крупная порция)", raw: "30 г/мл", cooked: "30 г/мл", note: "лучше отмерять ложкой или на весах" },
    ],
    footer: "Жиры не «плохие», но очень калорийные. Лучше отмерять ложкой или на весах, а не «на глаз».",
  },
  {
    id: "fruits",
    title: "Фрукты",
    subtitle: "почти всё 1 к 1, банан — исключение",
    accent: "from-violet-500/25 to-transparent",
    rows: [
      { product: "Груша", raw: "100 г", cooked: "100 г", note: "фрукты в основном 1 к 1" },
      { product: "Апельсин", raw: "100 г", cooked: "100 г", note: "фрукты в основном 1 к 1" },
      { product: "Банан", raw: "50 г", cooked: "50 г", note: "банан калорийнее, поэтому порция меньше" },
      { product: "Абрикос", raw: "100 г", cooked: "100 г", note: "фрукты в основном 1 к 1" },
      { product: "Нектарин", raw: "100 г", cooked: "100 г", note: "фрукты в основном 1 к 1" },
      { product: "Персик", raw: "100 г", cooked: "100 г", note: "фрукты в основном 1 к 1" },
    ],
    footer: "Фрукты не запрещаем. Просто учитываем порцию. Банан калорийнее, поэтому его замена меньше.",
  },
];

export function FoodSwapGuide() {
  const [openId, setOpenId] = useState<string | null>("principles");

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-widest text-gold">Справочник</p>
        <h2 className="text-2xl font-serif text-ivory">Взаимозамена продуктов</h2>
        <p className="text-sm text-warm-gray">
          Как читать сырой и готовый вес без путаницы. Данные — рабочие ориентиры, одинаковый способ
          взвешивания важнее «магической» точности.
        </p>
      </header>

      <div className="space-y-3">
        {SECTIONS.map((s) => {
          const open = openId === s.id;
          return (
            <article
              key={s.id}
              className={`overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br ${s.accent}`}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <div>
                  <h3 className="text-base font-semibold text-ivory">{s.title}</h3>
                  <p className="mt-0.5 text-xs text-warm-gray">{s.subtitle}</p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-gold transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>

              {open && (
                <div className="border-t border-gold/15 bg-black/20 px-2 py-3 sm:px-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-separate border-spacing-y-1 text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-widest text-gold">
                          <th className="px-3 py-2 text-left font-medium">Продукт</th>
                          <th className="px-3 py-2 text-left font-medium">Вес по списку</th>
                          <th className="px-3 py-2 text-left font-medium">Готовый вес</th>
                          <th className="px-3 py-2 text-left font-medium">Важно</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.rows.map((r, i) => (
                          <tr key={i} className="rounded-xl bg-ivory/[0.03]">
                            <td className="rounded-l-xl px-3 py-2 text-ivory">{r.product}</td>
                            <td className="px-3 py-2 text-warm-gray">{r.raw}</td>
                            <td className="px-3 py-2 text-warm-gray">{r.cooked}</td>
                            <td className="rounded-r-xl px-3 py-2 text-warm-gray">{r.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {s.footer && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-gold/20 bg-black/30 px-3 py-2 text-xs text-ivory">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <span>{s.footer}</span>
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <TeaCoffeeCard />
    </section>
  );
}

function TeaCoffeeCard() {
  return (
    <article className="rounded-2xl border border-gold/30 bg-gradient-to-br from-amber-900/30 via-black/30 to-transparent p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full border border-gold/40 bg-black/40 text-gold">
          <Coffee className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] uppercase tracking-widest text-gold">Напитки</p>
          <h3 className="text-lg font-semibold text-ivory">Чай и кофе на курсе</h3>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Block
          title="Можно ли?"
          items={[
            "Да, чай и кофе разрешены — они не «ломают» дефицит.",
            "Считаем только то, что добавляем: сахар, сиропы, мёд, молоко, сливки, ПП-заменители.",
            "Чистый чай, чёрный кофе и эспрессо в КБЖУ можно не учитывать.",
          ]}
        />
        <Block
          title="Сколько"
          items={[
            "Кофе: до 2–3 чашек эспрессо в день (≈ 300–400 мг кофеина суммарно).",
            "Чай: 3–5 чашек, зелёный/чёрный/травяной — по вкусу.",
            "Молоко в кофе: 30–50 мл — не считаем; больше — записываем в дневник.",
          ]}
        />
        <Block
          title="Когда"
          items={[
            "Первую чашку — не натощак, а после стакана воды и, желательно, после завтрака.",
            "Последний кофе — минимум за 6–8 часов до сна, чтобы не портить восстановление.",
            "Перед тренировкой эспрессо за 30–40 минут — отличный вариант.",
          ]}
        />
        <Block
          title="Какое"
          items={[
            "Лучше зерновой кофе (эспрессо, американо, фильтр), молотый под турку.",
            "3-в-1, ванильные латте с сиропами, «raf» с сахаром — это десерт, а не напиток.",
            "Чай — листовой, без сахара. Молочные улуны с сахаром считаем как сладкое.",
            "На курсе аккуратнее с кофе на голодный желудок при гастрите/рефлюксе.",
          ]}
        />
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-gold/20 bg-black/30 px-3 py-2 text-xs text-ivory">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
        <span>
          Правило простое: сам напиток — свободно, всё сладкое и жирное к нему — считаем. И
          не забываем воду: чай и кофе её не заменяют.
        </span>
      </p>
    </article>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-black/25 p-4">
      <p className="text-[11px] uppercase tracking-widest text-gold">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-ivory/90">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gold" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

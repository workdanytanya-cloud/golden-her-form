import weightloss from "@/assets/program-weightloss.jpg";
import home from "@/assets/program-home.jpg";
import stretch from "@/assets/program-stretch.jpg";
import tone from "@/assets/program-tone.jpg";
import nutrition from "@/assets/program-nutrition.jpg";
import coaching from "@/assets/program-coaching.jpg";
import { Reveal } from "@/components/ui/Reveal";

const programs = [
  {
    img: weightloss,
    tag: "Снижение веса",
    title: "Похудение",
    text: "12-недельная программа с плавным дефицитом, силовыми и кардио-блоками.",
    weeks: "12 недель",
  },
  {
    img: home,
    tag: "Дом",
    title: "Домашние тренировки",
    text: "Без зала и сложного оборудования. Занимайся в любой точке мира.",
    weeks: "8 недель",
  },
  {
    img: stretch,
    tag: "Гибкость",
    title: "Растяжка",
    text: "Мягкие сессии на восстановление подвижности и глубокое расслабление.",
    weeks: "6 недель",
  },
  {
    img: tone,
    tag: "Форма",
    title: "Мышечный тонус",
    text: "Силовая работа на подтянутое тело и красивый рельеф — без \"мужского\" эффекта.",
    weeks: "10 недель",
  },
  {
    img: nutrition,
    tag: "Питание",
    title: "Сбалансированное питание",
    text: "Индивидуальный расчёт КБЖУ и план, который работает в реальной жизни.",
    weeks: "Каждый месяц",
  },
  {
    img: coaching,
    tag: "Premium",
    title: "Персональный коучинг",
    text: "Прямая работа со мной 1:1. Ежедневная поддержка, разборы, корректировка.",
    weeks: "3 месяца",
  },
];

export function Programs() {
  return (
    <section id="programs" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">Программы</p>
            <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
              Выбери свой <span className="gold-text italic">путь.</span>
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-ivory/60">
            Каждая программа адаптируется под тебя после заполнения анкеты. Можно совмещать, менять
            интенсивность, ставить паузу — всё гибко.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <article className="group relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-gold/12">
                <img
                  src={p.img}
                  alt={p.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.08]"
                  loading="lazy"
                  width={1200}
                  height={1500}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(11,11,12,0.15) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0.92) 100%)",
                  }}
                />
                <div className="absolute inset-0 flex flex-col justify-between p-7">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-gold/40 bg-background/40 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-gold backdrop-blur">
                      {p.tag}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.24em] text-ivory/60">
                      {p.weeks}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-display text-3xl text-ivory">{p.title}</h3>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-ivory/75">{p.text}</p>
                    <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-gold transition-transform duration-500 group-hover:translate-x-1">
                      Подробнее
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </div>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "@/components/ui/Reveal";

const steps = [
  {
    n: "01",
    title: "Регистрация",
    text: "Создаёшь личный кабинет — все материалы будут храниться в одном месте.",
  },
  {
    n: "02",
    title: "Анкета",
    text: "Отвечаешь на вопросы о теле, целях, опыте и ритме жизни. Занимает 5 минут.",
  },
  {
    n: "03",
    title: "Расчёт КБЖУ",
    text: "Я даю гибкую калорийность, белки, жиры и углеводы под любой ритм жизни.",
  },
  {
    n: "04",
    title: "Персональный план",
    text: "Я собираю тренировочную программу и питание под твои показатели.",
  },
  {
    n: "05",
    title: "Тренируешься",
    text: "Занимаешься 3–5 раз в неделю, отмечаешь прогресс, задаёшь вопросы в чате.",
  },
  {
    n: "06",
    title: "Получаешь результат",
    text: "Каждые 2 недели — контрольные замеры и корректировка плана.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="max-w-3xl">
          <p className="eyebrow">Как это работает</p>
          <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
            Шесть шагов <span className="gold-text italic">до результата.</span>
          </h2>
        </div>

        <ol className="mt-16 relative">
          {/* rail */}
          <div className="absolute left-6 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-gold/40 to-transparent lg:left-1/2 lg:-translate-x-1/2" />

          {steps.map((s, i) => {
            const flip = i % 2 === 1;
            return (
              <Reveal
                as="li"
                key={s.n}
                delay={i * 90}
                className="relative pl-16 pb-12 lg:pl-0 lg:pb-16"
              >
                <span className="absolute left-6 top-1 flex h-3 w-3 -translate-x-1/2 items-center justify-center lg:left-1/2">
                  <span className="h-2 w-2 rounded-full bg-gold" />
                  <span className="absolute h-4 w-4 rounded-full border border-gold/40" />
                </span>

                <div
                  className={`grid gap-2 lg:grid-cols-2 lg:gap-16 ${
                    flip ? "lg:[&>*:first-child]:col-start-2 lg:[&>*:first-child]:text-left" : ""
                  }`}
                >
                  <div className={flip ? "lg:pl-16" : "lg:pr-16 lg:text-right"}>
                    <div className="font-display text-4xl text-gold sm:text-5xl">{s.n}</div>
                    <h3 className="mt-2 font-display text-2xl text-ivory sm:text-3xl">{s.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-ivory/65 lg:max-w-sm lg:ml-auto">
                      {flip ? null : s.text}
                    </p>
                    {flip && (
                      <p className="mt-3 text-sm leading-relaxed text-ivory/65 lg:max-w-sm">
                        {s.text}
                      </p>
                    )}
                  </div>
                  <div className="hidden lg:block" />
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

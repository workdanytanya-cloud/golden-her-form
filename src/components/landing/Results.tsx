import { BeforeAfterSlider } from "@/components/ui/BeforeAfterSlider";
import { Reveal } from "@/components/ui/Reveal";
import { CountUp } from "@/components/ui/CountUp";
import before from "@/assets/before.jpg";
import after from "@/assets/after.jpg";
import measurementsPhoto from "@/assets/trainer-measurements.jpg";

const cases = [
  {
    name: "Анна, 34",
    result: "−11 кг за 4 месяца",
    detail: "Вернула энергию и полюбила отражение в зеркале.",
  },
  {
    name: "Юлия, 28",
    result: "Тонус за 8 недель",
    detail: "Тренировки стали привычкой, тело подтянулось.",
  },
  {
    name: "Марина, 41",
    result: "Форма после родов",
    detail: "Вернула талию и удерживает результат полгода.",
  },
];

const stats = [
  { value: 10000, suffix: "+", label: "Подопечных", decimals: false },
  { value: 98, suffix: "%", label: "Достигают цели", decimals: false },
  { value: 12, suffix: " нед", label: "Средний срок", decimals: false },
  { value: 4.9, suffix: "/5", label: "Рейтинг", decimals: true },
];

export function Results() {
  return (
    <section id="results" className="section-y relative bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <p className="eyebrow">Результаты</p>
          <h2 className="mt-5 font-display text-3xl leading-tight text-ivory sm:text-4xl md:text-5xl lg:text-6xl">
            Это <span className="gold-text italic">работает.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm text-ivory/65">
            Реальные трансформации за 3–6 месяцев. Без ретуши.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal delay={100} className="lg:col-span-7">
            <BeforeAfterSlider before={before} after={after} />
          </Reveal>

          <Reveal delay={180} className="flex flex-col justify-center lg:col-span-5">
            <div className="overflow-hidden rounded-2xl border border-gold/15">
              <img
                src={measurementsPhoto}
                alt="Контроль прогресса с клиентом"
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
            </div>
            <p className="mt-4 text-sm text-ivory/60">
              Замеры и корректировка плана каждые 2 недели.
            </p>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <div className="card-interactive stat-pulse rounded-2xl border border-gold/15 bg-surface/50 p-5 text-center sm:p-6">
                <div className="font-display text-3xl text-ivory sm:text-4xl">
                  {s.decimals ? (
                    <>
                      {s.value.toFixed(1)}
                      {s.suffix}
                    </>
                  ) : (
                    <CountUp to={s.value} suffix={s.suffix} />
                  )}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.24em] text-warm-gray">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {cases.map((c, i) => (
            <Reveal key={c.name} delay={i * 100}>
              <article className="card-interactive h-full rounded-2xl border border-gold/12 bg-surface/40 p-5 sm:p-6">
                <p className="font-display text-lg text-gold">{c.result}</p>
                <p className="mt-2 text-sm leading-relaxed text-ivory/75">{c.detail}</p>
                <p className="mt-4 text-xs uppercase tracking-[0.24em] text-warm-gray">{c.name}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

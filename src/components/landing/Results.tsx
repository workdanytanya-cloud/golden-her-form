import { BeforeAfterSlider } from "@/components/ui/BeforeAfterSlider";
import { Reveal } from "@/components/ui/Reveal";
import { CountUp } from "@/components/ui/CountUp";
import before from "@/assets/before.jpg";
import after from "@/assets/after.jpg";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Анна, 34",
    text: "За 4 месяца сбросила 11 кг и наконец полюбила своё отражение. Программа честная, без чудес — только работа и поддержка Тани.",
  },
  {
    name: "Юлия, 28",
    text: "Раньше не могла заставить себя тренироваться регулярно. С Таней это стало ритуалом, а не наказанием. Тело подтянулось за 8 недель.",
  },
  {
    name: "Марина, 41",
    text: "После двух родов не верила, что смогу вернуть форму. Смогла. Спасибо за терпение и внимание к каждой мелочи.",
  },
];

export function Results() {
  return (
    <section id="results" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-6">
            <Reveal>
              <p className="eyebrow">Результаты</p>
              <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
                Реальные <span className="gold-text italic">трансформации.</span>
              </h2>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-ivory/65">
                Потяни ползунок и посмотри, как меняется тело за 3–6 месяцев работы. Никакой
                ретуши, никаких обещаний за неделю.
              </p>
            </Reveal>

            <Reveal delay={200} className="mt-10">
              <BeforeAfterSlider before={before} after={after} />
            </Reveal>
          </div>

          <div className="flex flex-col justify-center gap-6 lg:col-span-6">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 120}>
                <figure className="glass rounded-2xl p-7">
                  <div className="flex items-center gap-1 text-gold">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <Star key={k} className="h-4 w-4 fill-gold" strokeWidth={0} />
                    ))}
                  </div>
                  <blockquote className="mt-4 font-display text-lg leading-relaxed text-ivory">
                    “{t.text}”
                  </blockquote>
                  <figcaption className="mt-5 text-xs uppercase tracking-[0.24em] text-warm-gray">
                    {t.name}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Stat strip */}
        <div className="mt-20 grid grid-cols-2 gap-4 border-t border-gold/15 pt-10 sm:grid-cols-4 sm:gap-8">
          <StatMini value={500} suffix="+" label="Клиенток" />
          <StatMini value={98} suffix="%" label="Достигают цели" />
          <StatMini value={12} suffix=" нед" label="Средний срок" />
          <StatMini value={4.9} suffix="/5" label="Рейтинг отзывов" decimals />
        </div>
      </div>
    </section>
  );
}

function StatMini({
  value,
  suffix,
  label,
  decimals,
}: {
  value: number;
  suffix: string;
  label: string;
  decimals?: boolean;
}) {
  if (decimals) {
    return (
      <div>
        <div className="font-display text-3xl text-ivory sm:text-4xl">
          {value.toFixed(1)}
          {suffix}
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.24em] text-warm-gray">{label}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-display text-3xl text-ivory sm:text-4xl">
        <CountUp to={value} suffix={suffix} />
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.24em] text-warm-gray">{label}</div>
    </div>
  );
}

import { Reveal } from "@/components/ui/Reveal";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Анна, 34",
    text: "За 4 месяца сбросила 11 кг. Программа честная — только работа и поддержка.",
  },
  {
    name: "Юлия, 28",
    text: "С Таней тренировки стали ритуалом. Тело подтянулось за 8 недель.",
  },
  {
    name: "Марина, 41",
    text: "После двух родов вернула форму. Терпение и внимание к каждой детали.",
  },
];

export function Testimonials() {
  return (
    <section id="reviews" className="section-y relative bg-background">
      <div
        className="absolute inset-0 -z-10 opacity-50"
        style={{
          background:
            "radial-gradient(50% 40% at 80% 10%, rgba(200,154,74,0.10), transparent 60%), radial-gradient(50% 40% at 10% 90%, rgba(200,154,74,0.06), transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <p className="eyebrow">Отзывы</p>
          <h2 className="mt-5 font-display text-3xl leading-tight text-ivory sm:text-4xl md:text-5xl lg:text-6xl">
            Голоса <span className="gold-text italic">клиентов.</span>
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 100}>
              <figure className="card-interactive glass h-full rounded-2xl p-6 sm:p-7">
                <div className="flex items-center gap-1 text-gold">
                  {Array.from({ length: 5 }).map((_, k) => (
                    <Star key={k} className="h-4 w-4 fill-gold" strokeWidth={0} />
                  ))}
                </div>
                <blockquote className="mt-4 font-display text-base leading-relaxed text-ivory sm:text-lg">
                  «{t.text}»
                </blockquote>
                <figcaption className="mt-5 text-xs uppercase tracking-[0.24em] text-warm-gray">
                  {t.name}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

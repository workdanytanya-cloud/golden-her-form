import {
  UserRound,
  MessageCircle,
  Apple,
  Dumbbell,
  Flame,
  BadgeCheck,
} from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const items = [
  {
    icon: UserRound,
    title: "Индивидуальный подход",
    text: "Тренировки и питание разрабатываются под твоё тело, ритм жизни и цель.",
  },
  {
    icon: MessageCircle,
    title: "Постоянная поддержка",
    text: "Отвечаю в мессенджере, разбираю технику, корректирую план по неделям.",
  },
  {
    icon: Apple,
    title: "Баланс питания",
    text: "Без запретов и голода. Учу выстраивать рацион, который работает на результат.",
  },
  {
    icon: Dumbbell,
    title: "Персональные тренировки",
    text: "Программы под уровень: дома, в зале, для восстановления или набора формы.",
  },
  {
    icon: Flame,
    title: "Мотивация и дисциплина",
    text: "Помогаю выстроить систему, в которой хочется продолжать — а не бросать.",
  },
  {
    icon: BadgeCheck,
    title: "Реальный результат",
    text: "Отслеживаемый прогресс: замеры, фото, самочувствие — каждые 2 недели.",
  },
];

export function WhyChoose() {
  return (
    <section id="why" className="relative bg-background py-24 lg:py-40">
      {/* soft gradient */}
      <div
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(50% 40% at 80% 10%, rgba(200,154,74,0.10), transparent 60%), radial-gradient(50% 40% at 10% 90%, rgba(200,154,74,0.06), transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="max-w-3xl">
          <p className="eyebrow">Почему меня выбирают</p>
          <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
            Не марафон —<br />
            <span className="gold-text italic">персональная работа.</span>
          </h2>
        </div>

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <Reveal key={it.title} delay={i * 80}>
                <article className="group relative h-full overflow-hidden rounded-3xl border border-gold/12 bg-surface/60 p-8 transition-all duration-500 hover:border-gold/40 hover:bg-surface">
                  <div
                    className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--gold), transparent)",
                    }}
                  />
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold transition-transform duration-500 group-hover:scale-110">
                    <Icon strokeWidth={1.5} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-6 font-display text-2xl text-ivory">{it.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-ivory/65">{it.text}</p>
                  <div className="mt-8 text-[10px] uppercase tracking-[0.32em] text-warm-gray">
                    0{i + 1}
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

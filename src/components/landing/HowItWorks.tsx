import { Reveal } from "@/components/ui/Reveal";
import consultationPhoto from "@/assets/trainer-consultation.jpg";
import sessionPhoto from "@/assets/trainer-session.jpg";
import measurementsPhoto from "@/assets/trainer-measurements.jpg";
import highfivePhoto from "@/assets/trainer-highfive.png";

const steps = [
  {
    n: "01",
    title: "Заявка и анкета",
    text: "5 минут — о целях, теле и ритме жизни.",
    img: consultationPhoto,
    alt: "Консультация с клиентом",
  },
  {
    n: "02",
    title: "Персональный план",
    text: "KBJU, тренировки и питание под ваши показатели.",
    img: measurementsPhoto,
    alt: "Замеры и контроль прогресса",
  },
  {
    n: "03",
    title: "Тренировки с поддержкой",
    text: "3–5 раз в неделю, разбор техники в чате.",
    img: sessionPhoto,
    alt: "Тренировка с клиентом",
  },
  {
    n: "04",
    title: "Результат",
    text: "Замеры каждые 2 недели, корректировка плана.",
    img: highfivePhoto,
    alt: "Празднование результата с клиентом",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="section-y relative bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <p className="eyebrow">Сопровождение</p>
          <h2 className="mt-4 font-display text-2xl leading-snug text-ivory sm:text-3xl md:text-4xl">
            Как это <span className="text-coral">проходит?</span>
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <article className="card-interactive group overflow-hidden rounded-3xl border border-gold/12 bg-surface/40">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={s.img}
                    alt={s.alt}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                  <span className="absolute left-5 top-5 font-display text-3xl text-gold/80">{s.n}</span>
                </div>
                <div className="p-5 sm:p-6">
                  <h3 className="font-display text-lg text-ivory sm:text-xl">{s.title}</h3>
                  <p className="mt-2 text-base text-warm-gray">{s.text}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

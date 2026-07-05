import aboutEnv from "@/assets/about-env.jpg";
import { Reveal } from "@/components/ui/Reveal";

const timeline = [
  { year: "2014", text: "Первая сертификация. Начало пути в фитнес-индустрии." },
  { year: "2017", text: "Специализация в женской физиологии и восстановлении после родов." },
  { year: "2020", text: "Запуск онлайн-коучинга. Более 200 клиенток за первый год." },
  { year: "Сегодня", text: "500+ трансформаций и авторская методика тренировок." },
];

const certs = ["FPA", "NASM-CPT", "Pre/Postnatal", "Nutrition L2", "Mobility Specialist"];

export function About() {
  return (
    <section id="about" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-20">
          <Reveal className="lg:col-span-5">
            <div className="relative">
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-gold/15">
                <img
                  src={aboutEnv}
                  alt="Пространство для тренировок Тани"
                  className="h-full w-full object-cover"
                  loading="lazy"
                  width={1400}
                  height={1600}
                />
              </div>
              {/* floating badge */}
              <div className="glass absolute -bottom-8 -right-4 hidden max-w-[220px] rounded-2xl p-5 sm:block">
                <p className="eyebrow">Миссия</p>
                <p className="mt-2 font-display text-lg leading-snug text-ivory">
                  Возвращать женщинам ощущение своего тела.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={120}>
            <p className="eyebrow">О тренере</p>
            <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
              Меня зовут <span className="gold-text italic">Таня.</span>
              <br />И это моя работа —<br />
              делать тебя сильнее.
            </h2>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-ivory/70">
              Более 10 лет я работаю с женщинами разного возраста и подготовки. Моя методика — это не
              про диеты и запреты, а про дисциплину, регулярность и уважение к своему телу. Я
              выстраиваю тренировочный процесс так, чтобы каждая моя клиентка приходила к своей цели
              без выгорания.
            </p>

            {/* certificates */}
            <div className="mt-10">
              <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Сертификаты</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {certs.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-gold/25 bg-surface/50 px-4 py-1.5 text-xs tracking-wide text-ivory/85"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* timeline */}
            <div className="mt-12">
              <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Путь</p>
              <ol className="mt-6 space-y-6 border-l border-gold/20 pl-8">
                {timeline.map((t, i) => (
                  <Reveal as="li" key={t.year} delay={i * 90} className="relative">
                    <span className="absolute -left-[35px] top-1 flex h-3 w-3 items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-gold" />
                      <span className="absolute h-3 w-3 rounded-full border border-gold/40" />
                    </span>
                    <div className="font-display text-xl text-gold">{t.year}</div>
                    <p className="mt-1 text-sm text-ivory/70">{t.text}</p>
                  </Reveal>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

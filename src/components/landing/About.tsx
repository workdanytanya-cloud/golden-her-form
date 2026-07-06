import aboutPhoto from "@/assets/trainer-stretch.jpg.asset.json";
import matPhoto from "@/assets/trainer-mat.jpg.asset.json";
import { Reveal } from "@/components/ui/Reveal";

const timeline = [
  { year: "2010", text: "Прошла путь от 75+ кг до 47 кг за 10 месяцев. Так родилась авторская методика." },
  { year: "2011", text: "Начало тренерского пути. Первые персональные подопечные." },
  { year: "2017", text: "Запуск онлайн-наставничества. Сотни трансформаций." },
  { year: "Сегодня", text: "10 000+ человек дошли со мной до заветной цифры и удержали результат." },
];

const bullets = [
  "17+ лет в фитнесе",
  "15+ лет в тренерстве",
  "9+ лет онлайн-наставничества",
  "10 000+ подопечных",
];

export function About() {
  return (
    <section id="about" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-20">
          <Reveal className="lg:col-span-5">
            <div className="relative">
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-gold/25">
                <img
                  src={aboutPhoto.url}
                  alt="Татьяна Панова — фитнес-тренер"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, transparent 55%, rgba(11,10,8,0.55) 100%)",
                  }}
                />
              </div>
              {/* second photo */}
              <div className="absolute -bottom-10 -left-6 hidden aspect-[3/4] w-40 overflow-hidden rounded-2xl border border-coral/40 shadow-2xl sm:block">
                <img src={matPhoto.url} alt="Тренировка" className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="glass absolute -top-6 -right-4 hidden max-w-[220px] rounded-2xl p-5 sm:block">
                <p className="eyebrow">Миссия</p>
                <p className="mt-2 font-display text-lg leading-snug text-ivory">
                  Гармония с телом и едой — навсегда.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={120}>
            <p className="eyebrow">PanovaPRO · Обо мне</p>
            <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
              Меня зовут <span className="gold-text italic">Татьяна Панова.</span>
              <br />
              <br />
              <br />И я знаю, как <span className="text-coral italic">вернуть</span> тебя себе.
            </h2>

            <div className="mt-8 space-y-5 max-w-xl text-base leading-relaxed text-ivory/75">
              <p>
                Я — фитнес-тренер и наставник. Каждый месяц «спасаю» девушек и женщин от признаков
                РПП, монодиет, волшебных бобов и миллионных повторений на пресс, которые не приносят
                результата.
              </p>
              <p>
                В 2010 году я прошла путь от 75+ кг (при росте 158 — очень ощутимо) до 47 кг за
                10 месяцев. Мне знакомо желание закрыться дома, стесняться фотографироваться и не
                смотреть в отражение зеркала. Этот опыт помогает мне понимать <em>каждого</em>{" "}
                подопечного.
              </p>
              <p>
                Создаю индивидуальные системы похудения для женщин и мужчин — без срывов и голодовок.
                Авторская программа помогает оставаться в гармонии с едой и чувствовать себя
                комфортно на праздниках и в отпуске.
              </p>
              <p className="text-ivory">
                От неуверенности и комплексов к фигуре мечты — всего один шаг.
                <br />
                <br />
                <br />
                <span className="gold-text">Давайте сделаем его вместе.</span>
              </p>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {bullets.map((b) => (
                <div
                  key={b}
                  className="rounded-2xl border border-gold/25 bg-surface/60 px-4 py-4 text-center"
                >
                  <p className="font-display text-sm text-ivory">{b}</p>
                </div>
              ))}
            </div>

            <div className="mt-12">
              <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Путь</p>
              <ol className="mt-6 space-y-6 border-l border-gold/25 pl-8">
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

import ctaBg from "@/assets/cta-bg.jpg";
import { Reveal } from "@/components/ui/Reveal";

export function CtaFinal() {
  return (
    <section id="cta" className="relative overflow-hidden bg-background">
      <div className="absolute inset-0">
        <img
          src={ctaBg}
          alt="Начни трансформацию"
          className="h-full w-full object-cover"
          loading="lazy"
          width={1920}
          height={1200}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,11,12,0.55) 0%, rgba(11,11,12,0.35) 50%, rgba(11,11,12,0.85) 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-32 text-center lg:px-10 lg:py-48">
        <Reveal>
          <p className="eyebrow">Пора начать</p>
          <h2 className="mt-6 font-display text-5xl leading-[0.95] text-ivory sm:text-6xl lg:text-[6.5rem]">
            Твой момент —<br />
            <span className="gold-text italic">сейчас.</span>
          </h2>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-ivory/80 sm:text-lg">
            Оставь заявку — я свяжусь с тобой в течение дня, отвечу на вопросы и подберу программу
            под твою цель. Первая консультация бесплатно.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="mailto:hello@panovapro.ru"
              className="inline-flex items-center gap-3 rounded-full bg-gold px-8 py-4 text-sm font-medium tracking-wide text-background transition-transform hover:scale-[1.03]"
            >
              Записаться на консультацию
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a
              href="#programs"
              className="inline-flex items-center gap-3 rounded-full border border-ivory/30 px-8 py-4 text-sm font-medium text-ivory transition-colors hover:border-gold hover:text-gold"
            >
              Посмотреть программы
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

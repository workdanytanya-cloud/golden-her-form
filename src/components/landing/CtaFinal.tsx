import consultationPhoto from "@/assets/trainer-consultation.jpg";
import { Reveal } from "@/components/ui/Reveal";

export function CtaFinal() {
  return (
    <section id="cta" className="relative overflow-hidden bg-background">
      <div className="absolute inset-0">
        <img
          src={consultationPhoto}
          alt="Бесплатная консультация"
          className="h-full w-full object-cover"
          loading="lazy"
          width={1920}
          height={1200}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,11,12,0.55) 0%, rgba(11,11,12,0.35) 50%, rgba(11,11,12,0.88) 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24 lg:px-10 lg:py-36">
        <Reveal>
          <p className="eyebrow">Заявка</p>
          <h2 className="mt-5 font-display text-3xl leading-[1.05] text-white sm:text-5xl sm:leading-[0.95] md:text-6xl lg:text-[5rem]">
            Начните
            <br />
            <span className="gold-text">сегодня.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
            Оставьте заявку — свяжусь в течение дня, отвечу на вопросы и подберу программу.
            Первая консультация бесплатно.
          </p>

          <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <a
              href="https://t.me/Tanya_panova"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-3 rounded-lg bg-coral px-6 py-3.5 text-sm font-medium tracking-wide text-white transition-transform hover:scale-[1.03] sm:px-8 sm:py-4"
            >
              Написать в Telegram
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a
              href="mailto:panova.fortuna@mail.ru"
              className="break-anywhere inline-flex items-center justify-center gap-3 rounded-lg border border-white/35 px-6 py-3.5 text-sm font-medium text-white transition-colors hover:border-gold hover:text-gold sm:px-8 sm:py-4"
            >
              panova.fortuna@mail.ru
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

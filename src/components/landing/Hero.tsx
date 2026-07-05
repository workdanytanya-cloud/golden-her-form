import { useEffect, useRef } from "react";
import heroBg from "@/assets/hero-bg.jpg";
import { CountUp } from "@/components/ui/CountUp";

export function Hero() {
  const imgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = window.scrollY;
      el.style.transform = `translate3d(0, ${y * 0.15}px, 0) scale(${1 + y * 0.0002})`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section id="top" className="relative min-h-[100svh] w-full overflow-hidden bg-background">
      {/* Parallax image */}
      <div
        ref={imgRef}
        className="absolute inset-0 -z-10 will-change-transform"
        style={{
          backgroundImage: `url(${heroBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center right",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,11,12,0.75) 0%, rgba(11,11,12,0.45) 40%, rgba(11,11,12,0.85) 100%), radial-gradient(60% 60% at 20% 40%, rgba(200,154,74,0.15), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-between px-6 pt-32 pb-16 lg:px-10 lg:pt-40">
        <div className="max-w-3xl">
          <p className="eyebrow animate-reveal">Женский фитнес-коучинг</p>
          <h1 className="mt-6 font-display text-5xl leading-[0.95] text-ivory sm:text-6xl lg:text-[7.5rem]">
            Твоё тело.
            <br />
            <span className="gold-text italic">Твоя дисциплина.</span>
          </h1>
          <p className="mt-8 max-w-xl text-base leading-relaxed text-ivory/75 sm:text-lg">
            10 лет я помогаю женщинам возвращать форму, силу и уверенность — без диет-крайностей и
            изнуряющих тренировок. Персональный подход, честный результат.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#cta"
              className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium tracking-wide text-background transition-transform hover:scale-[1.02]"
            >
              Начать трансформацию
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-1">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a
              href="#cta"
              className="inline-flex items-center gap-3 rounded-full border border-ivory/25 px-7 py-4 text-sm font-medium text-ivory transition-colors hover:border-gold hover:text-gold"
            >
              Бесплатная консультация
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-4 border-t border-gold/15 pt-10 sm:gap-10 lg:mt-24">
          <Stat value={500} suffix="+" label="Довольных клиенток" />
          <Stat value={10} suffix="+" label="Лет опыта" />
          <Stat value={100} suffix="%" label="Индивидуальный подход" />
        </div>
      </div>

      {/* scroll cue */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 text-[10px] uppercase tracking-[0.32em] text-ivory/50">
        <span className="h-px w-8 bg-gold/50" />
        Листайте
        <span className="h-px w-8 bg-gold/50" />
      </div>
    </section>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div>
      <div className="font-display text-4xl text-ivory sm:text-5xl lg:text-6xl">
        <CountUp to={value} suffix={suffix} />
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.24em] text-warm-gray sm:text-sm">
        {label}
      </div>
    </div>
  );
}

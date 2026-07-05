import { useEffect, useRef } from "react";
import heroPhoto from "@/assets/trainer-beach.jpg.asset.json";
import { CountUp } from "@/components/ui/CountUp";

export function Hero() {
  const imgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = window.scrollY;
      el.style.transform = `translate3d(0, ${y * 0.12}px, 0) scale(${1 + y * 0.00018})`;
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
          backgroundImage: `url(${heroPhoto.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center 20%",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,10,8,0.55) 0%, rgba(11,10,8,0.25) 35%, rgba(11,10,8,0.85) 100%), radial-gradient(70% 60% at 15% 30%, rgba(230,120,70,0.22), transparent 70%), radial-gradient(60% 60% at 90% 80%, rgba(220,170,90,0.20), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-between px-6 pt-32 pb-16 lg:px-10 lg:pt-40">
        <div className="max-w-3xl">
          <p className="eyebrow animate-reveal">PanovaPRO · Татьяна Панова</p>
          <h1 className="mt-6 font-display text-5xl leading-[0.95] text-ivory sm:text-6xl lg:text-[7rem]">
            От неуверенности —<br />
            <span className="gold-text italic">к фигуре мечты.</span>
          </h1>
          <p className="mt-8 max-w-xl text-base leading-relaxed text-ivory/85 sm:text-lg">
            Я — фитнес-тренер и наставник с опытом 15+ лет. Помогаю женщинам и мужчинам обрести
            стройное тело без срывов, монодиет и голодовок. Просто система, которая работает.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#cta"
              className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium tracking-wide text-background transition-transform hover:scale-[1.02]"
              style={{ boxShadow: "0 12px 40px -12px oklch(0.78 0.15 78 / 0.6)" }}
            >
              Начать трансформацию
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-1">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a
              href="#cta"
              className="inline-flex items-center gap-3 rounded-full border border-ivory/30 px-7 py-4 text-sm font-medium text-ivory transition-colors hover:border-coral hover:text-coral"
            >
              Бесплатная консультация
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-4 border-t border-gold/20 pt-10 sm:gap-10 lg:mt-24">
          <Stat value={17} suffix="+" label="Лет в фитнесе" />
          <Stat value={15} suffix="+" label="Лет в тренерстве" />
          <Stat value={10000} suffix="+" label="Подопечных" />
        </div>
      </div>

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

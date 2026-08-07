import { useEffect, useRef } from "react";
import heroPhoto from "@/assets/trainer-highfive.jpg";
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
      <div
        ref={imgRef}
        className="absolute inset-0 -z-10 will-change-transform"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundSize: "cover",
          backgroundPosition: "center 30%",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,10,8,0.55) 0%, rgba(11,10,8,0.25) 35%, rgba(11,10,8,0.88) 100%), radial-gradient(70% 60% at 15% 30%, rgba(230,120,70,0.22), transparent 70%), radial-gradient(60% 60% at 90% 80%, rgba(220,170,90,0.20), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-between px-4 pb-16 pt-24 sm:px-6 sm:pb-14 sm:pt-28 lg:px-10 lg:pt-36">
        <div className="max-w-3xl">
          <p className="eyebrow animate-reveal text-[0.65rem] sm:text-[0.72rem]">PanovaPRO · Татьяна Панова</p>
          <h1 className="mt-4 font-display text-[2rem] leading-[1.05] text-white sm:mt-5 sm:text-5xl sm:leading-[0.95] md:text-6xl lg:text-[5.5rem] xl:text-[7rem]">
            Стройное тело
            <br />
            <span className="gold-text">и уверенность в зеркале.</span>
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/85 sm:mt-6 sm:text-base sm:leading-relaxed">
            Персональные тренировки и питание под ваш ритм жизни.
            <br />
            Система, которая держит результат — с праздниками, поездками и плотным графиком.
            <br />
            15+ лет опыта · 10 000+ подопечных.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <a
              href="#cta"
              className="group inline-flex w-full items-center justify-center gap-3 rounded-lg bg-coral px-6 py-3.5 text-sm font-medium tracking-wide text-white transition-transform hover:scale-[1.02] sm:w-auto sm:px-7 sm:py-4"
              style={{ boxShadow: "0 12px 40px -12px oklch(0.6 0.19 28 / 0.45)" }}
            >
              Оставить заявку
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-1">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <a
              href="#results"
              className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-white/35 px-6 py-3.5 text-sm font-medium text-white transition-colors hover:border-coral hover:text-coral sm:w-auto sm:px-7 sm:py-4"
            >
              Смотреть результаты
            </a>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-2 border-t border-white/20 pt-6 sm:mt-12 sm:gap-6 sm:pt-8 lg:mt-20 lg:gap-10">
          <Stat value={10000} suffix="+" label="Подопечных" />
          <Stat value={98} suffix="%" label="Достигают цели" />
          <Stat value={12} suffix=" нед" label="Средний срок" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[10px] uppercase tracking-[0.32em] text-white/50 sm:bottom-5 sm:flex">
        <span className="h-px w-8 bg-gold/50" />
        Листайте
        <span className="h-px w-8 bg-gold/50" />
      </div>
    </section>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div className="stat-pulse min-w-0 text-center sm:text-left">
      <div className="font-display text-2xl text-white sm:text-3xl md:text-5xl lg:text-6xl">
        <CountUp to={value} suffix={suffix} />
      </div>
      <div className="mt-1 text-[10px] uppercase leading-tight tracking-[0.16em] text-white/55 sm:mt-2 sm:text-xs sm:tracking-[0.24em]">
        {label}
      </div>
    </div>
  );
}

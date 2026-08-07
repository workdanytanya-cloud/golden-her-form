import { useEffect, useRef } from "react";
import heroPhoto from "@/assets/trainer-highfive.png";
import { CountUp } from "@/components/ui/CountUp";
import { useLeadForm } from "@/components/ui/LeadFormModal";

export function Hero() {
  const imgRef = useRef<HTMLDivElement | null>(null);
  const { openLeadForm } = useLeadForm();

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
    <section
      id="top"
      className="relative min-h-[100svh] w-full overflow-hidden"
      style={{ backgroundColor: "#1a1410" }}
    >
      {/* z-0/1 — не отрицательный: иначе фон .landing перекрывает фото */}
      <div
        ref={imgRef}
        className="absolute inset-0 z-0 will-change-transform"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundSize: "cover",
          backgroundPosition: "center 40%",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(105deg, rgba(14,11,9,0.88) 0%, rgba(14,11,9,0.55) 42%, rgba(14,11,9,0.35) 68%, rgba(14,11,9,0.72) 100%), linear-gradient(180deg, rgba(14,11,9,0.55) 0%, transparent 35%, rgba(14,11,9,0.9) 100%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-between px-4 pb-14 pt-24 sm:px-6 sm:pb-16 sm:pt-28 lg:px-10 lg:pt-32">
        <div className="max-w-2xl">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-coral-soft">
            PanovaPRO · Татьяна Панова
          </p>
          <h1 className="mt-4 font-display text-3xl leading-tight text-white sm:mt-5 sm:text-4xl md:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
            Стройное тело
            <br />
            <span className="text-coral-soft">и уверенность в зеркале.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/90 sm:mt-6 sm:text-lg">
            Персональные тренировки и питание под ваш ритм жизни. Система, которая держит
            результат — с праздниками, поездками и плотным графиком.
          </p>
          <p className="mt-3 text-sm text-white/70">15+ лет опыта · 10 000+ подопечных.</p>

          <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => openLeadForm({ source: "general" })}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coral px-6 py-3.5 text-sm font-semibold tracking-wide text-white transition-transform hover:scale-[1.02] sm:w-auto"
              style={{ boxShadow: "0 12px 32px -10px rgba(180,70,40,0.55)" }}
            >
              Оставить заявку
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-1">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <a
              href="#results"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/10 px-6 py-3.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/18 sm:w-auto"
            >
              Смотреть результаты
            </a>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3 border-t border-white/25 pt-6 sm:mt-12 sm:gap-8 sm:pt-8">
          <Stat value={10000} suffix="+" label="Подопечных" />
          <Stat value={98} suffix="%" label="Достигают цели" />
          <Stat value={12} suffix=" нед" label="Средний срок" />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div className="min-w-0 text-center sm:text-left">
      <div className="font-display text-2xl text-white sm:text-3xl md:text-4xl">
        <CountUp to={value} suffix={suffix} />
      </div>
      <div className="mt-1 text-[11px] uppercase leading-tight tracking-[0.14em] text-white/65 sm:text-xs">
        {label}
      </div>
    </div>
  );
}

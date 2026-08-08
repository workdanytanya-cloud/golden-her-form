import { Link } from "@tanstack/react-router";
import consultationPhoto from "@/assets/trainer-consultation.jpg";
import { Reveal } from "@/components/ui/Reveal";
import { useLeadForm } from "@/components/ui/LeadFormModal";

export function CtaFinal() {
  const { openLeadForm } = useLeadForm();

  return (
    <section id="cta" className="relative overflow-hidden" style={{ backgroundColor: "#1a1410" }}>
      <div className="absolute inset-0 z-0">
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
              "linear-gradient(180deg, rgba(14,11,9,0.72) 0%, rgba(14,11,9,0.55) 45%, rgba(14,11,9,0.9) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-10 lg:py-24">
        <Reveal>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-coral-soft">Заявка</p>
          <h2 className="mt-4 font-display text-3xl leading-tight text-white sm:text-4xl md:text-5xl">
            Начните <span className="text-coral-soft">сегодня.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-white/90">
            Оставьте заявку — свяжусь в течение дня, отвечу на вопросы и подберу программу.
            Первая консультация бесплатно.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => openLeadForm({ source: "general" })}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-coral px-6 py-3.5 text-sm font-semibold tracking-wide text-white transition-transform hover:scale-[1.03]"
            >
              Оставить заявку
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => openLeadForm({ source: "question" })}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/10 px-6 py-3.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/18"
            >
              Задать вопрос
            </button>
          </div>
          <p className="mt-5 text-sm text-white/75">
            Уже есть промокод или кабинет?{" "}
            <Link
              to="/auth"
              className="font-medium text-coral-soft underline-offset-4 transition-colors hover:text-white hover:underline"
            >
              Войти
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

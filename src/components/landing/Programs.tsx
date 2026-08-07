import { Link } from "@tanstack/react-router";
import { programs } from "@/lib/programs-data";
import { Reveal } from "@/components/ui/Reveal";

export function Programs() {
  return (
    <section id="programs" className="section-y relative bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <p className="eyebrow">Программы</p>
          <h2 className="mt-5 font-display text-3xl leading-tight text-ivory sm:text-4xl md:text-5xl lg:text-6xl">
            Что <span className="gold-text">подойдёт вам?</span>
          </h2>
          <p className="mt-4 max-w-md text-sm text-ivory/60">
            План подстраивается под вашу цель после короткой анкеты.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p, i) => (
            <Reveal key={p.slug} delay={i * 70}>
              <Link
                to="/programs/$slug"
                params={{ slug: p.slug }}
                className="card-interactive group relative block aspect-[3/4] w-full overflow-hidden rounded-3xl border border-gold/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <img
                  src={p.img}
                  alt={p.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]"
                  loading="lazy"
                  width={1200}
                  height={1500}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(11,11,12,0.15) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0.92) 100%)",
                  }}
                />
                <div className="absolute inset-0 flex flex-col justify-between p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-gold/40 bg-background/40 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-gold backdrop-blur">
                      {p.tag}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.24em] text-white/60">{p.weeks}</span>
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white sm:text-2xl">{p.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm text-white/75">{p.text.split(".")[0]}.</p>
                    <div className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-gold transition-transform duration-500 group-hover:translate-x-1">
                      Подробнее
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

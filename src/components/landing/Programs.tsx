import { Link } from "@tanstack/react-router";
import { programs } from "@/lib/programs-data";
import { Reveal } from "@/components/ui/Reveal";

export function Programs() {
  return (
    <section id="programs" className="relative bg-background py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Программы</p>
              <h2 className="mt-2 font-display text-2xl leading-snug text-ivory sm:text-3xl">
                Что <span className="text-coral">подойдёт вам?</span>
              </h2>
            </div>
            <p className="max-w-xs text-sm text-warm-gray sm:text-right">
              План под цель — после короткой анкеты.
            </p>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {programs.map((p, i) => (
            <Reveal key={p.slug} delay={i * 50}>
              <Link
                to="/programs/$slug"
                params={{ slug: p.slug }}
                className="group relative flex h-44 overflow-hidden rounded-2xl border border-coral/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral sm:h-48"
              >
                <img
                  src={p.img}
                  alt={p.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  loading="lazy"
                  width={800}
                  height={500}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(14,11,9,0.35) 0%, rgba(14,11,9,0.25) 40%, rgba(14,11,9,0.88) 100%)",
                  }}
                />
                <div className="relative z-10 flex h-full w-full flex-col justify-between p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-coral px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                      {p.tag}
                    </span>
                    <span className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
                      {p.weeks}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-display text-lg leading-tight text-white sm:text-xl">
                      {p.title}
                    </h3>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-coral-soft transition-transform duration-300 group-hover:translate-x-1">
                      Выбрать
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
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

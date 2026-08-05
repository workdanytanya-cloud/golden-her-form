import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";
import { useAuth } from "@/lib/auth";
import { getProgramBySlug, programs, type ProgramDetail } from "@/lib/programs-data";

export const Route = createFileRoute("/programs/$slug")({
  loader: ({ params }) => {
    const program = getProgramBySlug(params.slug);
    if (!program) throw notFound();
    return { program };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Программа не найдена" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.program;
    return {
      meta: [
        { title: `${p.title} — PanovaPRO` },
        { name: "description", content: p.text },
        { property: "og:title", content: `${p.title} — PanovaPRO` },
        { property: "og:description", content: p.text },
      ],
    };
  },
  component: ProgramPage,
  notFoundComponent: NotFound,
});

function ProgramPage() {
  const { program } = Route.useLoaderData();
  const { session } = useAuth();
  const p: ProgramDetail = program;
  const others = programs.filter((x) => x.slug !== p.slug).slice(0, 3);

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Nav />

      {/* Hero */}
      <section className="relative pt-24 sm:pt-28 lg:pt-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <Link
            to="/"
            hash="programs"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-ivory/60 transition-colors hover:text-gold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            Все программы
          </Link>

          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-block rounded-full border border-gold/40 bg-background/40 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-gold">
                {p.tag} · {p.weeks}
              </span>
              <h1 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
                {p.title}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-ivory/75">{p.intro}</p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  to={session ? "/dashboard" : "/auth"}
                  search={session ? undefined : { mode: "signup" }}
                  className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.03]"
                >
                  Записаться на программу
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
                <a
                  href="https://t.me/Tanya_panova"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-2 rounded-lg border border-gold/30 px-6 py-3 text-sm text-ivory transition-colors hover:border-gold hover:text-gold"
                >
                  Задать вопрос
                </a>
              </div>
            </div>

            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-gold/12">
              <img src={p.img} alt={p.title} className="h-full w-full object-cover" />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(11,11,12,0) 40%, rgba(11,11,12,0.6) 100%)",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* For whom + Includes */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-2 lg:px-10">
          <div className="rounded-3xl border border-gold/15 bg-background/40 p-8 lg:p-10">
            <p className="eyebrow">Для кого</p>
            <ul className="mt-6 space-y-4">
              {p.forWhom.map((f) => (
                <li key={f} className="flex gap-3 text-sm leading-relaxed text-ivory/85">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-gold/15 bg-background/40 p-8 lg:p-10">
            <p className="eyebrow">Что входит</p>
            <ul className="mt-6 space-y-4">
              {p.includes.map((f) => (
                <li key={f} className="flex gap-3 text-sm leading-relaxed text-ivory/85">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mt-0.5 shrink-0 text-gold">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Weekly plan */}
      <section className="border-t border-gold/10 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <p className="eyebrow">Структура</p>
          <h2 className="mt-6 font-display text-3xl leading-tight text-ivory sm:text-4xl lg:text-5xl">
            Как выстроена программа
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {p.weekly.map((w, i) => (
              <div key={w.title} className="rounded-3xl border border-gold/15 bg-background/40 p-8">
                <span className="font-display text-4xl text-gold">0{i + 1}</span>
                <h3 className="mt-4 font-display text-xl text-ivory">{w.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ivory/70">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="border-t border-gold/10 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
            <div>
              <p className="eyebrow">Результат</p>
              <h2 className="mt-6 font-display text-3xl leading-tight text-ivory sm:text-4xl lg:text-5xl">
                Что ты получишь
              </h2>
            </div>
            <ul className="space-y-5">
              {p.results.map((r) => (
                <li key={r} className="flex gap-4 border-b border-gold/10 pb-5 text-base text-ivory/85">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mt-0.5 shrink-0 text-gold">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gold/10 py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-10">
          <h2 className="font-display text-3xl leading-tight text-ivory sm:text-4xl lg:text-5xl">
            Готова начать <span className="gold-text italic">«{p.title}»</span>?
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-ivory/70">
            Заполни анкету — я подберу интенсивность, питание и график под тебя. Первый шаг занимает
            5 минут.
          </p>
          <Link
            to={session ? "/dashboard" : "/auth"}
            search={session ? undefined : { mode: "signup" }}
            className="mt-10 inline-flex items-center gap-2 rounded-lg bg-gold px-7 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.03]"
          >
            Записаться
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Other programs */}
      <section className="border-t border-gold/10 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <p className="eyebrow">Другие программы</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((o) => (
              <Link
                key={o.slug}
                to="/programs/$slug"
                params={{ slug: o.slug }}
                className="group relative block aspect-[3/4] overflow-hidden rounded-3xl border border-gold/12"
              >
                <img src={o.img} alt={o.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.08]" loading="lazy" />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(11,11,12,0.15) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0.92) 100%)",
                  }}
                />
                <div className="absolute inset-0 flex flex-col justify-end p-7">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-gold">{o.tag}</span>
                  <h3 className="mt-2 font-display text-2xl text-ivory">{o.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function NotFound() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Nav />
      <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-6 font-display text-4xl text-ivory sm:text-5xl">Программа не найдена</h1>
        <p className="mt-4 text-sm text-ivory/70">Похоже, такой программы нет. Посмотри доступные направления.</p>
        <Link
          to="/"
          hash="programs"
          className="mt-10 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 text-sm font-medium text-background"
        >
          К программам
        </Link>
      </section>
      <Footer />
    </main>
  );
}

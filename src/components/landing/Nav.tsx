import { useEffect, useState } from "react";

const links = [
  { href: "#about", label: "О тренере" },
  { href: "#why", label: "Почему я" },
  { href: "#programs", label: "Программы" },
  { href: "#results", label: "Результаты" },
  { href: "#how", label: "Как это работает" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled ? "backdrop-blur-xl bg-background/70 border-b border-gold/10" : ""
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
        <a href="#top" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/40">
            <span className="font-display text-lg text-gold">T</span>
          </span>
          <span className="font-display text-lg tracking-wide text-ivory">
            Tanya <span className="text-gold">Fitness</span>
          </span>
        </a>

        <nav className="hidden items-center gap-9 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="gold-underline text-sm tracking-wide text-ivory/80 transition-colors hover:text-ivory"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:block">
          <a
            href="#cta"
            className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-background transition-transform hover:scale-[1.03]"
          >
            Начать
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>

        <button
          aria-label="Меню"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 text-ivory lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M6 6l12 12M18 6l-12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-gold/10 bg-background/95 px-6 py-6 backdrop-blur-xl lg:hidden">
          <nav className="flex flex-col gap-4">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display text-2xl text-ivory"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#cta"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-medium text-background"
            >
              Начать трансформацию
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

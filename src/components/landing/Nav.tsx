import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";

const links = [
  { href: "#results", label: "Результаты" },
  { href: "#programs", label: "Программы" },
  { href: "#how", label: "Сопровождение" },
  { href: "#reviews", label: "Отзывы" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { session } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Home hero is full-bleed photo — light type until scroll. Elsewhere: ink on light.
  const onMedia = isHome && !scrolled && !open;
  const linkCls = onMedia
    ? "text-white/85 hover:text-white"
    : "text-foreground/75 hover:text-foreground";
  const brandCls = onMedia ? "text-white" : "text-foreground";
  const menuBtnCls = onMedia
    ? "border-white/35 text-white"
    : "border-coral/25 text-foreground";

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled || open
          ? "border-b border-coral/10 bg-background/85 backdrop-blur-xl"
          : ""
      }`}
    >
      <div className="safe-px mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-10">
        <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
          <img src={logo} alt="PanovaPRO" className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" />
          <span className={`truncate font-display text-base tracking-wide sm:text-lg ${brandCls}`}>
            Panova<span className="text-gold">PRO</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`gold-underline text-sm tracking-wide transition-colors ${linkCls}`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          {session ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-coral px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            >
              Личный кабинет
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className={`text-sm tracking-wide transition-colors ${linkCls}`}
              >
                Войти
              </Link>
              <a
                href="#cta"
                className="inline-flex items-center gap-2 rounded-lg bg-coral px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
              >
                Заявка
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </>
          )}
        </div>

        <button
          aria-label="Меню"
          className={`flex h-10 w-10 items-center justify-center rounded-full border lg:hidden ${menuBtnCls}`}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M6 6l12 12M18 6l-12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-coral/10 bg-background/95 px-6 py-6 backdrop-blur-xl lg:hidden">
          <nav className="flex flex-col gap-4">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display text-2xl text-foreground"
              >
                {l.label}
              </a>
            ))}
            {session ? (
              <Link
                to="/dashboard"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg bg-coral px-5 py-3 text-sm font-medium text-white"
              >
                Личный кабинет
              </Link>
            ) : (
              <a
                href="#cta"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg bg-coral px-5 py-3 text-sm font-medium text-white"
              >
                Оставить заявку
              </a>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

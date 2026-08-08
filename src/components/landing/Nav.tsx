import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useLeadForm } from "@/components/ui/LeadFormModal";
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
  const { openLeadForm } = useLeadForm();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
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

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open
          ? "border-b border-coral/15 bg-[#faf7f2]/95 backdrop-blur-xl shadow-sm"
          : "bg-gradient-to-b from-black/55 to-transparent"
      }`}
    >
      <div className="safe-px mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4 lg:px-10">
        <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
          <img src={logo} alt="PanovaPRO" className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" />
          <span
            className={`truncate font-display text-base tracking-wide sm:text-lg ${
              scrolled || open ? "text-[#1c1714]" : "text-white"
            }`}
          >
            Panova<span className={scrolled || open ? "text-coral" : "text-coral-soft"}>PRO</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm font-medium tracking-wide transition-colors ${
                scrolled || open
                  ? "text-[#3d342e] hover:text-coral"
                  : "text-white/90 hover:text-white"
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          {session ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-coral px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
            >
              Личный кабинет
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className={`text-sm font-medium tracking-wide transition-colors ${
                  scrolled || open
                    ? "text-[#3d342e] hover:text-coral"
                    : "text-white/90 hover:text-white"
                }`}
              >
                Войти
              </Link>
              <button
                type="button"
                onClick={() => openLeadForm({ source: "general" })}
                className="inline-flex items-center gap-2 rounded-lg bg-coral px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
              >
                Заявка
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </>
          )}
        </div>

        <button
          aria-label="Меню"
          className={`flex h-10 w-10 items-center justify-center rounded-full border lg:hidden ${
            scrolled || open
              ? "border-coral/30 text-[#1c1714]"
              : "border-white/40 text-white"
          }`}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M6 6l12 12M18 6l-12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-coral/10 bg-[#faf7f2] px-6 py-6 lg:hidden">
          <nav className="flex flex-col gap-4">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display text-xl text-[#1c1714]"
              >
                {l.label}
              </a>
            ))}
            {session ? (
              <Link
                to="/dashboard"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg bg-coral px-5 py-3 text-sm font-semibold text-white"
              >
                Личный кабинет
              </Link>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    openLeadForm({ source: "general" });
                  }}
                  className="inline-flex w-fit items-center gap-2 rounded-lg bg-coral px-5 py-3 text-sm font-semibold text-white"
                >
                  Оставить заявку
                </button>
                <Link
                  to="/auth"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-[#3d342e] underline-offset-4 hover:text-coral hover:underline"
                >
                  Уже есть промокод или кабинет? Войти
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

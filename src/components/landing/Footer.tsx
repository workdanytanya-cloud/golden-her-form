import logo from "@/assets/logo.png";

export function Footer() {
  return (
    <footer className="border-t border-gold/15 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3">
              <img src={logo} alt="PanovaPRO" className="h-10 w-10 shrink-0 object-contain" />
              <span className="font-display text-lg tracking-wide text-ivory">
                Panova<span className="text-gold">PRO</span>
              </span>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-ivory/65">
              Татьяна Панова — фитнес-тренер и наставник. Авторская система похудения онлайн.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Контакты</p>
            <ul className="mt-4 space-y-3 text-sm text-ivory/80">
              <li>
                <a href="mailto:panova.fortuna@mail.ru" className="gold-underline break-all">
                  panova.fortuna@mail.ru
                </a>
              </li>
              <li>
                <a
                  href="https://t.me/Tanya_panova"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="gold-underline"
                >
                  Telegram — @Tanya_panova
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Разделы</p>
            <ul className="mt-4 space-y-3 text-sm text-ivory/80">
              <li><a href="#results" className="gold-underline">Результаты</a></li>
              <li><a href="#programs" className="gold-underline">Программы</a></li>
              <li><a href="#how" className="gold-underline">Сопровождение</a></li>
              <li><a href="#faq" className="gold-underline">FAQ</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-gold/15 pt-6 text-xs text-warm-gray sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} PanovaPRO · Татьяна Панова. Все права защищены.</p>
          <p>Made with discipline · Информация на сайте</p>
        </div>
      </div>
    </footer>
  );
}

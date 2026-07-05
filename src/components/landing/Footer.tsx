export function Footer() {
  return (
    <footer className="border-t border-gold/10 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/40">
                <span className="font-display text-lg text-gold">T</span>
              </span>
              <span className="font-display text-lg tracking-wide text-ivory">
                Tanya <span className="text-gold">Fitness</span>
              </span>
            </div>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ivory/60">
              Премиальный женский фитнес-коучинг. Персональные программы тренировок и питания —
              онлайн, из любой точки мира.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Контакты</p>
            <ul className="mt-5 space-y-3 text-sm text-ivory/80">
              <li><a href="mailto:hello@tanyafitness.ru" className="gold-underline">hello@tanyafitness.ru</a></li>
              <li><a href="tel:+70000000000" className="gold-underline">+7 (000) 000-00-00</a></li>
              <li><a href="https://vk.com/public_fitness_tanya" target="_blank" rel="noreferrer noopener" className="gold-underline">VK-сообщество</a></li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-warm-gray">Разделы</p>
            <ul className="mt-5 space-y-3 text-sm text-ivory/80">
              <li><a href="#about" className="gold-underline">О тренере</a></li>
              <li><a href="#programs" className="gold-underline">Программы</a></li>
              <li><a href="#results" className="gold-underline">Результаты</a></li>
              <li><a href="#faq" className="gold-underline">FAQ</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-gold/10 pt-8 text-xs text-warm-gray sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Tanya Fitness. Все права защищены.</p>
          <p>Made with discipline · Не оферта</p>
        </div>
      </div>
    </footer>
  );
}

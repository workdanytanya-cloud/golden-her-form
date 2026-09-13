import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/Reveal";

const faqs = [
  {
    q: "Подойдёт ли программа новичку?",
    a: "Да. План масштабируется от нулевого до продвинутого уровня — укажите опыт в анкете.",
  },
  {
    q: "Сколько времени в день нужно?",
    a: "Тренировки 30–60 минут, 3–5 раз в неделю. Расписание под ваш график.",
  },
  {
    q: "Нужно ли специальное оборудование?",
    a: "Для дома — коврик и гантели. Для зала — стандартный инвентарь.",
  },
  {
    q: "Что если прогресс замедлится?",
    a: "Каждые 2 недели — замеры. При плато корректируем тренировки и питание.",
  },
  {
    q: "Есть ли возврат средств?",
    a: "Да, в течение 14 дней при добросовестном следовании плану. Подробности — в оферте.",
  },
  {
    q: "Могу ли я тренироваться во время беременности?",
    a: "Есть адаптированные программы для пре- и постнатального периода. Укажите это в анкете.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="section-y relative bg-background">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <div className="text-center">
            <p className="eyebrow">FAQ</p>
            <h2 className="mt-4 font-display text-2xl leading-snug text-ivory sm:text-3xl md:text-4xl">
              Остались <span className="text-coral">вопросы?</span>
            </h2>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <Accordion type="single" collapsible className="mt-10 divide-y divide-gold/15">
            {faqs.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`} className="border-none">
                <AccordionTrigger className="py-5 text-left font-display text-base text-ivory hover:no-underline sm:text-lg [&[data-state=open]>svg]:text-coral">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="pb-5 text-base leading-relaxed text-warm-gray">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}

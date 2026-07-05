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
    a: "Да. Все программы масштабируются под уровень — от нулевого до продвинутого. В анкете ты указываешь опыт, и я собираю план соответствующей сложности.",
  },
  {
    q: "Сколько времени в день нужно?",
    a: "Тренировки занимают от 30 до 60 минут, 3–5 раз в неделю. Расписание подстраивается под твой график.",
  },
  {
    q: "Нужно ли специальное оборудование?",
    a: "Нет. Для домашних программ достаточно коврика и одного набора гантелей. Для зала — стандартный инвентарь.",
  },
  {
    q: "Что если я перестану видеть результат?",
    a: "Каждые две недели мы делаем контрольные замеры. Если прогресс замедляется, я корректирую тренировочный или питательный блок.",
  },
  {
    q: "Есть ли возврат средств?",
    a: "Да, в течение 14 дней с момента покупки при условии, что ты добросовестно следовала плану. Условия — в оферте.",
  },
  {
    q: "Могу ли я тренироваться во время беременности?",
    a: "Есть отдельные адаптированные программы для пре- и постнатального периода. Обязательно указывай это в анкете.",
  },
  {
    q: "На каких устройствах доступен личный кабинет?",
    a: "Любой современный смартфон, планшет и компьютер. Отдельного приложения устанавливать не нужно.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative bg-background py-24 lg:py-40">
      <div className="mx-auto max-w-4xl px-6 lg:px-10">
        <Reveal>
          <div className="text-center">
            <p className="eyebrow">FAQ</p>
            <h2 className="mt-6 font-display text-4xl leading-tight text-ivory sm:text-5xl lg:text-6xl">
              Частые <span className="gold-text italic">вопросы.</span>
            </h2>
          </div>
        </Reveal>

        <Reveal delay={150}>
          <Accordion type="single" collapsible className="mt-14 divide-y divide-gold/15">
            {faqs.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`} className="border-none">
                <AccordionTrigger className="py-6 text-left font-display text-lg text-ivory hover:no-underline sm:text-xl [&[data-state=open]>svg]:text-gold">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-sm leading-relaxed text-ivory/65 sm:text-base">
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

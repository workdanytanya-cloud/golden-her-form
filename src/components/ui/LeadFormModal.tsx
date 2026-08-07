import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { toast } from "sonner";
import { submitLead } from "@/lib/leads.functions";

export type LeadFormOpenOptions = {
  source?: "general" | "program" | "question";
  programSlug?: string | null;
  programTitle?: string | null;
};

type LeadFormCtx = {
  openLeadForm: (opts?: LeadFormOpenOptions) => void;
};

const Ctx = createContext<LeadFormCtx | null>(null);

export function useLeadForm() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      openLeadForm: () => {
        console.warn("LeadFormProvider missing");
      },
    };
  }
  return ctx;
}

const inputCls =
  "w-full rounded-xl border border-coral/20 bg-white px-4 py-3 text-base text-[#1c1714] placeholder:text-[#8a7f76] outline-none transition-colors focus:border-coral sm:text-sm";

export function LeadFormProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<LeadFormOpenOptions>({ source: "general" });
  const submit = useServerFn(submitLead);

  const openLeadForm = useCallback((o?: LeadFormOpenOptions) => {
    setOpts({
      source: o?.source ?? "general",
      programSlug: o?.programSlug ?? null,
      programTitle: o?.programTitle ?? null,
    });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <Ctx.Provider value={{ openLeadForm }}>
      {children}
      {open && (
        <LeadFormDialog
          opts={opts}
          onClose={() => setOpen(false)}
          submit={submit}
        />
      )}
    </Ctx.Provider>
  );
}

function LeadFormDialog({
  opts,
  onClose,
  submit,
}: {
  opts: LeadFormOpenOptions;
  onClose: () => void;
  submit: (args: {
    data: Record<string, unknown>;
  }) => Promise<{
    ok: boolean;
    id: string | null;
    build?: string;
    notified?: boolean;
    envFlags?: Record<string, unknown>;
    notify?: {
      telegram: boolean;
      email: boolean;
      telegramReason: string | null;
      emailReason: string | null;
    };
  }>;
}) {
  const formId = useId();
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [messenger, setMessenger] = useState<"telegram" | "max" | "whatsapp" | "any">("telegram");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);

  const title =
    opts.source === "question"
      ? "Задать вопрос"
      : opts.programTitle
        ? `Запись: ${opts.programTitle}`
        : "Оставить заявку";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const result = await submit({
        data: {
          full_name: fullName,
          age: Number(age),
          phone,
          email,
          messenger,
          source: opts.source ?? "general",
          program_slug: opts.programSlug ?? null,
          program_title: opts.programTitle ?? null,
          website,
        },
      });
      if (result.notified === false) {
        const reasons = [
          result.notify?.telegramReason,
          result.notify?.emailReason,
        ]
          .filter(Boolean)
          .join(", ");
        toast.success("Заявка сохранена в базе.", {
          description: `Уведомление не ушло (${reasons || "нет канала"}). Сборка: ${result.build ?? "?"}`,
          duration: 12000,
        });
      } else if (result.build) {
        toast.success("Заявка отправлена! Свяжусь с вами в ближайшее время.", {
          description: `Сборка: ${result.build}`,
        });
      } else {
        toast.success("Заявка отправлена! Свяжусь с вами в ближайшее время.");
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка отправки";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        className="max-h-[92svh] w-full max-w-md overflow-y-auto rounded-3xl border border-coral/15 bg-[#faf7f2] p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-coral">Заявка</p>
            <h2 id={`${formId}-title`} className="mt-1 font-display text-xl text-[#1c1714] sm:text-2xl">
              {title}
            </h2>
            <p className="mt-2 text-sm text-[#5c524a]">
              Не регистрация — только заявка. Укажите телефон с Telegram, MAX или WhatsApp.
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8a7f76] hover:bg-black/5 hover:text-[#1c1714]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-3.5">
          {/* honeypot */}
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
          />

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#5c524a]">
              Фамилия и имя *
            </label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputCls}
              placeholder="Иванова Анна"
              autoComplete="name"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#5c524a]">
                Возраст *
              </label>
              <input
                required
                type="number"
                min={14}
                max={100}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className={inputCls}
                placeholder="32"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#5c524a]">
                Мессенджер *
              </label>
              <select
                value={messenger}
                onChange={(e) => setMessenger(e.target.value as typeof messenger)}
                className={inputCls}
              >
                <option value="telegram">Telegram</option>
                <option value="max">MAX</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="any">Любой</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#5c524a]">
              Телефон *
            </label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="+7 900 000-00-00"
              autoComplete="tel"
            />
            <p className="mt-1 text-[11px] text-[#8a7f76]">Номер, на котором есть выбранный мессенджер</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#5c524a]">
              Email *
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@mail.ru"
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="mt-2 w-full rounded-full bg-coral px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {sending ? "Отправляем…" : "Отправить заявку"}
          </button>
        </form>
      </div>
    </div>
  );
}

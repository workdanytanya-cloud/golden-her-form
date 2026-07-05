import { Info, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Inline hint block. Use at the top of each dashboard section.
 * tone="tip" — жёлтая подсказка "как заполнить"
 * tone="info" — нейтральный совет
 */
export function SectionHint({
  title,
  children,
  tone = "info",
}: {
  title?: string;
  children: ReactNode;
  tone?: "info" | "tip";
}) {
  const Icon = tone === "tip" ? Lightbulb : Info;
  const cls =
    tone === "tip"
      ? "border-gold/25 bg-gradient-to-r from-gold/10 via-transparent to-coral/5 text-ivory"
      : "border-gold/15 bg-background/40 text-ivory";
  const iconCls = tone === "tip" ? "text-gold" : "text-gold/80";
  return (
    <div className={`flex items-start gap-3 rounded-2xl border ${cls} p-4`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`} />
      <div className="min-w-0 text-sm leading-relaxed">
        {title && <p className="mb-0.5 font-medium text-ivory">{title}</p>}
        <div className="text-warm-gray">{children}</div>
      </div>
    </div>
  );
}

/**
 * Маленькая подсказка рядом с полем формы / заголовком.
 */
export function FieldHint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-warm-gray">
      <Info className="mt-0.5 h-3 w-3 shrink-0 text-gold/70" />
      <span>{children}</span>
    </p>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { Calendar as CalendarIcon, Download, Trash2, X } from "lucide-react";
import { MeasurementWizard } from "@/components/panel/MeasurementWizard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader } from "@/components/panel/PanelShell";
import { SectionHint } from "@/components/panel/Hints";
import { AccessGate } from "@/components/panel/AccessGate";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/progress")({
  component: ProgressPage,
});

type Measurement = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  chest_cm: number | null;
  note: string | null;
};

type MetricKey = "weight_kg" | "waist_cm" | "hips_cm" | "chest_cm";

const METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
}[] = [
  { key: "weight_kg", label: "Вес", unit: "кг", color: "oklch(0.78 0.15 78)" }, // gold
  { key: "waist_cm", label: "Талия", unit: "см", color: "oklch(0.68 0.21 25)" }, // coral
  { key: "hips_cm", label: "Бёдра", unit: "см", color: "oklch(0.72 0.12 200)" },
  { key: "chest_cm", label: "Грудь", unit: "см", color: "oklch(0.75 0.14 140)" },
];

function ProgressPage() {
  const { effectiveUserId, effectiveRole, effectiveAccessStatus } = useAuth();
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);


  // Filters
  const [from, setFrom] = useState<Date | undefined>(subDays(new Date(), 90));
  const [to, setTo] = useState<Date | undefined>(new Date());
  const [active, setActive] = useState<Record<MetricKey, boolean>>({
    weight_kg: true,
    waist_cm: true,
    hips_cm: false,
    chest_cm: false,
  });
  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);


  const canLoadProgress =
    effectiveRole === "admin" || effectiveAccessStatus === "active";

  const load = () => {
    if (!effectiveUserId || !canLoadProgress) {
      setItems([]);
      setLoading(false);
      return;
    }
    void supabase
      .from("measurements")
      .select("id, measured_on, weight_kg, waist_cm, hips_cm, chest_cm, note")
      .eq("user_id", effectiveUserId)
      .order("measured_on", { ascending: true })
      .then(({ data }) => {
        setItems((data ?? []) as Measurement[]);
        setLoading(false);
      });
  };

  useEffect(load, [effectiveUserId, canLoadProgress]);


  const filtered = useMemo(() => {
    return items.filter((m) => {
      const d = new Date(m.measured_on);
      if (from && d < startOfDay(from)) return false;
      if (to && d > endOfDay(to)) return false;
      return true;
    });
  }, [items, from, to]);

  const chartData = useMemo(
    () =>
      filtered.map((m) => ({
        date: m.measured_on,
        label: format(new Date(m.measured_on), "d MMM", { locale: ru }),
        weight_kg: m.weight_kg,
        waist_cm: m.waist_cm,
        hips_cm: m.hips_cm,
        chest_cm: m.chest_cm,
      })),
    [filtered],
  );

  const measurementDays = useMemo(
    () => new Set(items.map((m) => m.measured_on)),
    [items],
  );




  const remove = async (id: string) => {
    const { error } = await supabase.from("measurements").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Удалено");
    load();
  };

  const resetRange = () => {
    setFrom(undefined);
    setTo(undefined);
  };

  const quick = (days: number) => {
    setFrom(subDays(new Date(), days));
    setTo(new Date());
  };

  const exportPdf = async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro"),
      ]);
      // Small delay so button state repaints and chart animations settle
      await new Promise((r) => setTimeout(r, 80));
      const node = printRef.current;
      const canvas = await html2canvas(node, {
        backgroundColor: "#0b0a09",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      if (imgH <= pageH) {
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
      } else {
        // Slice tall canvas across pages
        const pageHpx = Math.floor((canvas.width * pageH) / pageW);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        const ctx = slice.getContext("2d")!;
        let y = 0;
        let first = true;
        while (y < canvas.height) {
          const h = Math.min(pageHpx, canvas.height - y);
          slice.height = h;
          ctx.fillStyle = "#0b0a09";
          ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
          const partData = slice.toDataURL("image/jpeg", 0.92);
          const partH = (h * imgW) / canvas.width;
          if (!first) pdf.addPage();
          pdf.addImage(partData, "JPEG", 0, 0, imgW, partH);
          first = false;
          y += h;
        }
      }

      const fromStr = from ? format(from, "yyyy-MM-dd") : "all";
      const toStr = to ? format(to, "yyyy-MM-dd") : "now";
      pdf.save(`PanovaPRO_progress_${fromStr}_${toStr}.pdf`);
      toast.success("Отчёт сохранён");
    } catch (e) {
      toast.error("Не удалось сформировать PDF");
      console.error(e);
    } finally {
      setExporting(false);
    }
  };



  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Прогресс"
        title="Мои замеры"
        description="Наблюдайте динамику на графике и держите замеры под рукой в календаре."
      />

      <AccessGate level="active">
        <div className="space-y-6">
          <SectionHint tone="tip" title="Как вести замеры">
            Делайте замеры <strong className="text-ivory">утром натощак</strong>, в одинаковой
            одежде, раз в неделю в один и тот же день. Так график покажет реальную динамику, а не
            случайные колебания.
          </SectionHint>

      {/* Filters */}

      <div className="flex flex-col gap-4 rounded-3xl border border-gold/15 bg-surface/40 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DatePop label="С" value={from} onChange={setFrom} />
          <DatePop label="По" value={to} onChange={setTo} />
          {(from || to) && (
            <button
              onClick={resetRange}
              className="inline-flex items-center gap-1 rounded-full border border-gold/20 px-3 py-2 text-xs text-warm-gray hover:text-ivory"
            >
              <X className="h-3.5 w-3.5" /> Сбросить
            </button>
          )}
          <div className="ml-1 flex gap-1">
            {[
              { d: 30, l: "30 дн" },
              { d: 90, l: "3 мес" },
              { d: 365, l: "Год" },
            ].map((q) => (
              <button
                key={q.d}
                onClick={() => quick(q.d)}
                className="rounded-full border border-gold/15 px-3 py-2 text-xs text-warm-gray hover:border-gold/50 hover:text-ivory"
              >
                {q.l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {METRICS.map((m) => {
            const on = active[m.key];
            return (
              <button
                key={m.key}
                onClick={() => setActive((a) => ({ ...a, [m.key]: !a[m.key] }))}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors",
                  on
                    ? "border-transparent bg-gradient-to-r from-coral/25 to-gold/25 text-ivory"
                    : "border-gold/15 text-warm-gray hover:text-ivory",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: m.color, opacity: on ? 1 : 0.4 }}
                />
                {m.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={exportPdf}
          disabled={exporting || filtered.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs font-medium uppercase tracking-widest text-background transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Готовим PDF…" : "Экспорт PDF"}
        </button>
      </div>

      {/* Printable report */}
      <div ref={printRef} className="space-y-8 rounded-3xl bg-background p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gold/15 pb-4">
          <div>
            <p className="font-display text-2xl">
              Panova<span className="text-coral">PRO</span>
              <span className="ml-3 text-xs uppercase tracking-widest text-gold">
                Отчёт о прогрессе
              </span>
            </p>
            <p className="mt-1 text-xs text-warm-gray">
              Период: {from ? format(from, "d MMM yyyy", { locale: ru }) : "с начала"} —{" "}
              {to ? format(to, "d MMM yyyy", { locale: ru }) : "по сегодня"} · Замеров:{" "}
              {filtered.length}
            </p>
          </div>
          <p className="text-xs text-warm-gray">
            Сформировано {format(new Date(), "d MMM yyyy, HH:mm", { locale: ru })}
          </p>
        </div>

        {/* Chart */}
        <section className="rounded-3xl border border-gold/15 bg-gradient-to-br from-surface/70 to-background/40 p-4 md:p-6">
          <div className="h-72 md:h-80">
            {loading ? (
              <div className="flex h-full items-center justify-center text-warm-gray">
                Загрузка…
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-warm-gray">
                Нет данных в выбранном диапазоне
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="oklch(0.35 0.01 70 / 0.3)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke="oklch(0.66 0.02 70)"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="oklch(0.66 0.02 70)"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={38}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.17 0.006 70)",
                      border: "1px solid oklch(0.78 0.15 78 / 0.3)",
                      borderRadius: 12,
                      color: "oklch(0.97 0.014 82)",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "oklch(0.66 0.02 70)" }}
                    formatter={(v: number, name: string) => {
                      const m = METRICS.find((x) => x.label === name);
                      return v == null ? ["—", name] : [`${v} ${m?.unit ?? ""}`, name];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: "oklch(0.66 0.02 70)" }}
                    iconType="circle"
                  />
                  {METRICS.filter((m) => active[m.key]).map((m) => (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.key}
                      name={m.label}
                      stroke={m.color}
                      strokeWidth={2.5}
                      dot={{ r: 3, strokeWidth: 0, fill: m.color }}
                      activeDot={{ r: 6 }}
                      connectNulls
                      isAnimationActive={!exporting}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Calendar */}
        <section className="rounded-3xl border border-gold/15 bg-surface/40 p-4">
          <p className="eyebrow mb-3 px-2">Календарь замеров</p>
          <div className="flex justify-center">
            <Calendar
              mode="single"
              locale={ru}
              selected={from}
              onSelect={(d) => d && setFrom(d)}
              weekStartsOn={1}
              modifiers={{
                measured: (day) => measurementDays.has(format(day, "yyyy-MM-dd")),
              }}
              modifiersClassNames={{
                measured:
                  "relative after:content-[''] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-1 after:h-1 after:w-1 after:rounded-full after:bg-gold",
              }}
              className="pointer-events-auto"
            />
          </div>
          <p className="mt-3 px-2 text-xs text-warm-gray">
            Точкой отмечены даты с замерами. Клик по дате задаёт «С».
          </p>
        </section>

        {/* Table */}
        <section>
          <h2 className="font-display text-2xl">История ({filtered.length})</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-gold/15">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/50 text-[11px] uppercase tracking-widest text-warm-gray">
                <tr>
                  <th className="px-5 py-3">Дата</th>
                  <th className="px-5 py-3">Вес</th>
                  <th className="px-5 py-3">Талия</th>
                  <th className="px-5 py-3">Бёдра</th>
                  <th className="px-5 py-3">Грудь</th>
                  <th className="px-5 py-3">Заметка</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-warm-gray">
                      В выбранном диапазоне пока нет замеров
                    </td>
                  </tr>
                ) : (
                  [...filtered].reverse().map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 text-ivory">
                        {format(new Date(m.measured_on), "d MMM yyyy", { locale: ru })}
                      </td>
                      <td className="px-5 py-3 text-warm-gray">{m.weight_kg ?? "—"}</td>
                      <td className="px-5 py-3 text-warm-gray">{m.waist_cm ?? "—"}</td>
                      <td className="px-5 py-3 text-warm-gray">{m.hips_cm ?? "—"}</td>
                      <td className="px-5 py-3 text-warm-gray">{m.chest_cm ?? "—"}</td>
                      <td className="px-5 py-3 text-warm-gray">{m.note ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => remove(m.id)}
                          className="rounded-full p-2 text-warm-gray hover:bg-coral/15 hover:text-coral"
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Add measurement (excluded from PDF) */}
      {effectiveUserId && (
        <section>
          <MeasurementWizard userId={effectiveUserId} onSaved={load} />
        </section>
      )}


        </div>
      </AccessGate>
    </div>
  );
}

function DatePop({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-gold/20 bg-background/40 px-4 py-2 text-xs text-ivory hover:border-gold/50",
            !value && "text-warm-gray",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-gold" />
          <span className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</span>
          <span>{value ? format(value, "d MMM yyyy", { locale: ru }) : "—"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ru}
          selected={value}
          onSelect={onChange}
          weekStartsOn={1}
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}


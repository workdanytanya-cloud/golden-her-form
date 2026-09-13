import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadPublishedPdfFn } from "@/lib/pdf/pdf.functions";
import { useAuth } from "@/lib/auth";

export function SnapshotPdfButton({
  kind,
  courseId,
  disabled,
}: {
  kind: "nutrition" | "training";
  courseId?: string | null;
  disabled?: boolean;
}) {
  const { impersonation } = useAuth();
  const [busy, setBusy] = useState(false);
  const label = kind === "nutrition" ? "Скачать питание в PDF" : "Скачать тренировки в PDF";

  const onClick = async () => {
    setBusy(true);
    try {
      const result = await downloadPublishedPdfFn({
        data: {
          kind,
          courseId: courseId ?? null,
          clientId: impersonation?.userId ?? null,
        },
      });
      const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: result.contentType || "application/pdf" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось скачать PDF";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || busy}
      className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/20 disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      {busy ? "Готовим PDF…" : label}
    </button>
  );
}

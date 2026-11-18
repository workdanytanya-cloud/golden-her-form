import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  component: ForgotPasswordPage,
});

const emailSchema = z.string().trim().email("Введите корректный email").max(255);
const NEUTRAL = "Если такой адрес зарегистрирован, ссылка отправлена.";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsed = emailSchema.parse(email);
      const { selfhostRequestPasswordReset } = await import("@/lib/selfhost/client-api");
      const res = await selfhostRequestPasswordReset(parsed);
      setSent(true);
      toast.success(res.message || NEUTRAL);
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.errors[0].message
          : err instanceof Error
            ? err.message
            : "Ошибка";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-ivory">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <Link to="/" className="mb-10 text-center font-display text-2xl text-ivory">
          Panova<span className="text-gold">PRO</span>
        </Link>

        <div className="glass rounded-3xl p-6 sm:p-8">
          <h1 className="font-display text-3xl text-ivory">Восстановление пароля</h1>
          <p className="mt-2 text-sm leading-relaxed text-warm-gray">
            {sent ? NEUTRAL : "Введите email — мы отправим ссылку для смены пароля."}
          </p>

          {!sent && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-base text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 min-h-11 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background disabled:opacity-60"
              >
                {submitting ? "..." : "Отправить ссылку"}
              </button>
            </form>
          )}

          <Link
            to="/auth"
            className="mt-6 block min-h-11 text-center text-sm leading-10 text-warm-gray transition-colors hover:text-ivory"
          >
            ← Назад ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}

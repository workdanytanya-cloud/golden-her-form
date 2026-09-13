import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  component: ForgotPasswordPage,
});

const emailSchema = z.string().trim().email("Введите корректный email").max(255);

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsed = emailSchema.parse(email);
      const { error } = await supabase.auth.resetPasswordForEmail(parsed, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Письмо отправлено");
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
    <div className="min-h-screen bg-background text-ivory">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <Link to="/" className="mb-10 text-center font-display text-2xl text-ivory">
          Panova<span className="text-gold">PRO</span>
        </Link>

        <div className="glass rounded-3xl p-8">
          <h1 className="font-display text-3xl text-ivory">Восстановление пароля</h1>
          <p className="mt-2 text-sm text-warm-gray">
            {sent
              ? "Мы отправили ссылку на восстановление пароля. Проверьте почту."
              : "Введите email — мы отправим ссылку для смены пароля."}
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
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {submitting ? "..." : "Отправить ссылку"}
              </button>
            </form>
          )}

          <Link
            to="/auth"
            className="mt-6 block text-center text-sm text-warm-gray transition-colors hover:text-ivory"
          >
            ← Назад ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}

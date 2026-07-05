import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(72, "Слишком длинный пароль");

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase parses the recovery link and emits PASSWORD_RECOVERY.
    // If the user reloads with a live session, allow updating too.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsed = passwordSchema.parse(password);
      if (parsed !== confirm) {
        throw new Error("Пароли не совпадают");
      }
      const { error } = await supabase.auth.updateUser({ password: parsed });
      if (error) throw error;
      toast.success("Пароль обновлён");
      await supabase.auth.signOut();
      await navigate({ to: "/auth" });
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
          <h1 className="font-display text-3xl text-ivory">Новый пароль</h1>
          <p className="mt-2 text-sm text-warm-gray">
            {ready
              ? "Придумайте новый пароль для вашего аккаунта."
              : "Проверяем ссылку восстановления..."}
          </p>

          {ready && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Новый пароль
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="Минимум 8 символов"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Повторите пароль
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {submitting ? "..." : "Сохранить пароль"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

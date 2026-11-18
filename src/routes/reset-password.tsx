import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  validateSearch: searchSchema,
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(72, "Слишком длинный пароль");

function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/reset-password" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ready = Boolean(search.token);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsed = passwordSchema.parse(password);
      if (parsed !== confirm) throw new Error("Пароли не совпадают");
      const token = search.token;
      if (!token) throw new Error("В ссылке нет токена восстановления");
      const { selfhostConfirmPasswordReset } = await import("@/lib/selfhost/client-api");
      await selfhostConfirmPasswordReset(token, parsed);
      toast.success("Пароль обновлён");
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
    <div className="min-h-screen overflow-x-hidden bg-background text-ivory">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <Link to="/" className="mb-10 text-center font-display text-2xl text-ivory">
          Panova<span className="text-gold">PRO</span>
        </Link>

        <div className="glass rounded-3xl p-6 sm:p-8">
          <h1 className="font-display text-3xl text-ivory">Новый пароль</h1>
          <p className="mt-2 text-sm leading-relaxed text-warm-gray">
            {ready
              ? "Придумайте новый пароль для вашего аккаунта."
              : "Ссылка недействительна или устарела. Запросите новую с экрана восстановления пароля."}
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
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-base text-ivory outline-none transition-colors focus:border-gold/60"
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
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-base text-ivory outline-none transition-colors focus:border-gold/60"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 min-h-11 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background disabled:opacity-60"
              >
                {submitting ? "..." : "Сохранить пароль"}
              </button>
            </form>
          )}

          {!ready && (
            <Link
              to="/forgot-password"
              className="mt-6 block text-center text-sm text-gold hover:underline"
            >
              Запросить новую ссылку
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

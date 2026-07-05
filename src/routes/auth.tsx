import { createFileRoute, redirect, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const searchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      throw redirect({ to: search.redirect ?? "/dashboard" });
    }
  },
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Введите корректный email").max(255);
const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(72, "Слишком длинный пароль");
const nameSchema = z.string().trim().min(1, "Введите имя").max(100);

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const { loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsedEmail = emailSchema.parse(email);
      const parsedPassword = passwordSchema.parse(password);

      if (mode === "signup") {
        const parsedName = nameSchema.parse(fullName);
        const { error } = await supabase.auth.signUp({
          email: parsedEmail,
          password: parsedPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: parsedName },
          },
        });
        if (error) throw error;
        toast.success("Аккаунт создан. Добро пожаловать!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsedEmail,
          password: parsedPassword,
        });
        if (error) throw error;
        toast.success("С возвращением!");
      }

      // brief delay so onAuthStateChange fires + role loads
      await new Promise((r) => setTimeout(r, 150));
      await navigate({ to: search.redirect ?? "/dashboard" });
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.errors[0].message
          : err instanceof Error
            ? err.message
            : "Ошибка авторизации";
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
          <h1 className="font-display text-3xl text-ivory">
            {mode === "signin" ? "Вход" : "Регистрация"}
          </h1>
          <p className="mt-2 text-sm text-warm-gray">
            {mode === "signin"
              ? "Войдите в свой личный кабинет"
              : "Создайте аккаунт и начните трансформацию"}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Имя
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="Ваше имя"
                  maxLength={100}
                />
              </div>
            )}
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
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                Пароль
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                placeholder="Минимум 8 символов"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={submitting || authLoading}
              className="mt-2 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {submitting
                ? "..."
                : mode === "signin"
                  ? "Войти"
                  : "Создать аккаунт"}
            </button>
          </form>

          {mode === "signin" && (
            <Link
              to="/forgot-password"
              className="mt-4 block text-center text-xs text-warm-gray transition-colors hover:text-gold"
            >
              Забыли пароль?
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 w-full text-center text-sm text-warm-gray transition-colors hover:text-ivory"
          >
            {mode === "signin"
              ? "Нет аккаунта? Зарегистрироваться"
              : "Уже есть аккаунт? Войти"}
          </button>
        </div>

        <Link
          to="/"
          className="mt-8 text-center text-sm text-warm-gray transition-colors hover:text-ivory"
        >
          ← На главную
        </Link>
      </div>
    </div>
  );
}

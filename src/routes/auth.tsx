import { createFileRoute, redirect, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { PostSignupGuide } from "@/components/ui/PostSignupGuide";

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
      throw redirect({ to: search.redirect ?? "/dashboard/onboarding" });
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

function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("email not confirmed")) {
    return "Email ещё не подтверждён. В Supabase отключите подтверждение почты или подтвердите пользователя в Authentication → Users.";
  }
  if (m.includes("invalid login credentials")) {
    return "Неверный email или пароль";
  }
  if (m.includes("user already registered")) {
    return "Этот email уже зарегистрирован. Войдите или восстановите пароль.";
  }
  return message;
}

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const { loading: authLoading, refreshAccess } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [postSignup, setPostSignup] = useState<{
    email: string;
    password: string;
    fullName: string;
  } | null>(null);

  const goAfterSignup = async () => {
    await refreshAccess();
    await navigate({ to: search.redirect ?? "/dashboard/onboarding" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup" && !consent) {
      toast.error("Нужно согласие на обработку персональных данных");
      return;
    }
    setSubmitting(true);
    try {
      const parsedEmail = emailSchema.parse(email);
      const parsedPassword = passwordSchema.parse(password);

      if (mode === "signup") {
        const parsedName = nameSchema.parse(fullName);
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: parsedEmail,
          password: parsedPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard/onboarding`,
            data: { full_name: parsedName },
          },
        });
        if (error) throw error;

        // If project requires email confirm, session may be null — sign in right away when allowed
        if (!signUpData.session) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: parsedEmail,
            password: parsedPassword,
          });
          if (signInError) throw signInError;
        }

        try {
          localStorage.removeItem("panovapro.installDismissed");
          localStorage.setItem("panovapro.pendingInstall", "1");
        } catch {
          /* ignore */
        }

        setPostSignup({
          email: parsedEmail,
          password: parsedPassword,
          fullName: parsedName,
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsedEmail,
          password: parsedPassword,
        });
        if (error) throw error;
        toast.success("С возвращением!");
        await refreshAccess();
        await navigate({ to: search.redirect ?? "/dashboard" });
      }
    } catch (err) {
      const raw =
        err instanceof z.ZodError
          ? err.errors[0].message
          : err instanceof Error
            ? err.message
            : "Ошибка авторизации";
      toast.error(mapAuthError(raw));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-ivory">
      {postSignup && (
        <PostSignupGuide
          email={postSignup.email}
          password={postSignup.password}
          fullName={postSignup.fullName}
          onDone={() => {
            setPostSignup(null);
            void goAfterSignup();
          }}
        />
      )}
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
        <Link to="/" className="mb-10 text-center font-display text-2xl text-ivory">
          Panova<span className="text-gold">PRO</span>
        </Link>

        <div className="glass rounded-3xl p-6 sm:p-8">
          <h1 className="font-display text-3xl text-ivory">
            {mode === "signin" ? "Вход" : "Регистрация"}
          </h1>
          <p className="mt-2 text-sm text-warm-gray">
            {mode === "signin"
              ? "Войдите в свой личный кабинет"
              : "Создайте аккаунт и начните трансформацию"}
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-4"
            autoComplete="on"
            name={mode === "signup" ? "signup" : "login"}
            method="post"
          >
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Имя
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="Ваше имя"
                  maxLength={100}
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                Email
              </label>
              <input
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 text-ivory outline-none transition-colors focus:border-gold/60"
                placeholder="you@example.com"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                Пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 pr-12 text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="Минимум 8 символов"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-warm-gray transition-colors hover:text-gold"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "signup" && (
                <p className="mt-2 text-[11px] text-warm-gray">
                  После создания аккаунта предложим сохранить пароль в браузере и добавить сайт на
                  рабочий стол.
                </p>
              )}
            </div>

            {mode === "signup" && (
              <label className="mt-1 flex items-start gap-3 text-xs text-warm-gray">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-gold"
                />
                <span>
                  Я согласен(на) на обработку моих персональных данных в соответствии с{" "}
                  <Link
                    to="/privacy"
                    target="_blank"
                    className="text-gold underline-offset-2 hover:underline"
                  >
                    Политикой конфиденциальности
                  </Link>
                  .
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={submitting || authLoading || (mode === "signup" && !consent)}
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

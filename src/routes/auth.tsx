import { createFileRoute, redirect, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { redeemPromoCode } from "@/lib/promo.functions";
import { toast } from "sonner";
import { PostSignupGuide } from "@/components/ui/PostSignupGuide";

const searchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup", "promo"]).optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session && search.mode === "promo") {
      return; // allow redeem while logged in
    }
    if (data.session) {
      if (search.redirect) {
        throw redirect({ to: search.redirect });
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id);
      const isAdmin = roles?.some((r) => r.role === "admin");
      throw redirect({ to: isAdmin ? "/admin" : "/dashboard/onboarding" });
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
const promoSchema = z
  .string()
  .trim()
  .min(4, "Введите промокод")
  .max(32);

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
  const { user, loading: authLoading, refreshAccess } = useAuth();
  const redeem = useServerFn(redeemPromoCode);

  const initialMode = search.mode ?? "signin";
  const [mode, setMode] = useState<"signin" | "signup" | "promo">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [promoCode, setPromoCode] = useState("");
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

  const activatePromo = async () => {
    const code = promoSchema.parse(promoCode);
    const result = await redeem({ data: { code } });
    await refreshAccess();
    if (result.already) {
      toast.success("Этот промокод уже активирован на вашем аккаунте");
    } else {
      toast.success(
        result.program_title
          ? `Доступ открыт: ${result.program_title}`
          : "Промокод принят — доступ в кабинет открыт",
      );
    }
    await navigate({ to: search.redirect ?? "/dashboard/onboarding" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((mode === "signup" || mode === "promo") && !user && !consent) {
      toast.error("Нужно согласие на обработку персональных данных");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "promo") {
        // Already logged in — only redeem
        if (user) {
          await activatePromo();
          return;
        }

        const parsedEmail = emailSchema.parse(email);
        const parsedPassword = passwordSchema.parse(password);
        const parsedName = nameSchema.parse(fullName);
        promoSchema.parse(promoCode);

        // Try sign in first (returning cash client), else sign up
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: parsedEmail,
          password: parsedPassword,
        });

        if (signInError) {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: parsedEmail,
            password: parsedPassword,
            options: {
              emailRedirectTo: `${window.location.origin}/dashboard/onboarding`,
              data: { full_name: parsedName },
            },
          });
          if (signUpError) {
            if (signUpError.message.toLowerCase().includes("already")) {
              throw new Error("Неверный email или пароль");
            }
            throw signUpError;
          }
          if (!signUpData.session) {
            const { error: again } = await supabase.auth.signInWithPassword({
              email: parsedEmail,
              password: parsedPassword,
            });
            if (again) throw again;
          }
          await supabase
            .from("profiles")
            .update({ full_name: parsedName })
            .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
        }

        await activatePromo();
        return;
      }

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

        const { data: userData } = await supabase.auth.getUser();
        let dest = search.redirect ?? "/dashboard";
        if (userData.user && !search.redirect) {
          const { data: roles } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userData.user.id);
          if (roles?.some((r) => r.role === "admin")) {
            dest = "/admin";
          }
        }
        await navigate({ to: dest });
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

  const title =
    mode === "promo"
      ? "Вход по промокоду"
      : mode === "signin"
        ? "Вход"
        : "Регистрация";
  const subtitle =
    mode === "promo"
      ? "Если оплатили наличными — введите код от тренера и создайте кабинет"
      : mode === "signin"
        ? "Войдите в свой личный кабинет"
        : "Создайте аккаунт и начните трансформацию";

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
          <h1 className="font-display text-3xl text-ivory">{title}</h1>
          <p className="mt-2 text-sm text-warm-gray">{subtitle}</p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 space-y-4"
            autoComplete="on"
            name={mode}
            method="post"
          >
            {mode === "promo" && (
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
                  Промокод
                </label>
                <input
                  type="text"
                  name="promo"
                  required
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gold/20 bg-background/50 px-4 py-3 font-mono tracking-wider text-ivory outline-none transition-colors focus:border-gold/60"
                  placeholder="PP-XXXXXX"
                  maxLength={32}
                  autoComplete="off"
                />
              </div>
            )}

            {((mode === "signup" || mode === "promo") && !user) && (
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

            {!user && (
              <>
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
                  {(mode === "signup" || mode === "promo") && (
                    <p className="mt-2 text-[11px] text-warm-gray">
                      Запомните пароль — он нужен для входа в кабинет.
                    </p>
                  )}
                </div>
              </>
            )}

            {(mode === "signup" || (mode === "promo" && !user)) && (
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
              disabled={
                submitting ||
                authLoading ||
                ((mode === "signup" || (mode === "promo" && !user)) && !consent)
              }
              className="mt-2 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {submitting
                ? "..."
                : mode === "promo"
                  ? "Активировать доступ"
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

          <div className="mt-6 space-y-3 text-center text-sm text-warm-gray">
            {mode !== "promo" && (
              <button
                type="button"
                onClick={() => setMode("promo")}
                className="block w-full transition-colors hover:text-gold"
              >
                Есть промокод (оплата наличными)?
              </button>
            )}
            {mode === "promo" ? (
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="block w-full transition-colors hover:text-ivory"
              >
                Обычный вход без промокода
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="block w-full transition-colors hover:text-ivory"
              >
                {mode === "signin"
                  ? "Нет аккаунта? Зарегистрироваться"
                  : "Уже есть аккаунт? Войти"}
              </button>
            )}
          </div>
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

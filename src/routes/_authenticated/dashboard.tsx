import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Profile = {
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
};

function DashboardPage() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, phone, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data);
        setLoading(false);
      });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Вы вышли из аккаунта");
    await navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background text-ivory">
      <header className="border-b border-gold/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-display text-xl">
            Panova<span className="text-gold">PRO</span>
          </Link>
          <div className="flex items-center gap-4">
            {role === "admin" && (
              <Link
                to="/admin"
                className="text-sm text-warm-gray transition-colors hover:text-ivory"
              >
                Админ-панель
              </Link>
            )}
            <button
              onClick={handleSignOut}
              className="rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-wider text-ivory transition-colors hover:bg-gold/10"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <p className="eyebrow">Личный кабинет</p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl">
          Добро пожаловать{profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="mt-3 text-warm-gray">{user?.email}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card
            title="Ваша роль"
            value={role === "admin" ? "Администратор" : "Клиент"}
          />
          <Card
            title="Email"
            value={user?.email ?? "—"}
          />
          <Card
            title="Телефон"
            value={loading ? "..." : profile?.phone ?? "Не указан"}
          />
        </div>

        <div className="glass mt-10 rounded-3xl p-8">
          <h2 className="font-display text-2xl text-ivory">Что дальше</h2>
          <p className="mt-3 text-sm text-warm-gray">
            Скоро здесь появится анкета, персональный план тренировок и питания.
            Мы готовим для вас лучший опыт.
          </p>
        </div>
      </main>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gold/15 bg-surface/40 p-6">
      <p className="text-xs uppercase tracking-wider text-warm-gray">{title}</p>
      <p className="mt-2 font-display text-xl text-ivory">{value}</p>
    </div>
  );
}

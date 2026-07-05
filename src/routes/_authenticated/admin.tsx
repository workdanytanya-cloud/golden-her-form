import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

type ClientRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
};

function AdminPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Admin bypasses profile RLS via has_role only from server; from the client
    // side we still respect RLS. For now show current user summary only.
    // In Phase 3 add a server function using requireSupabaseAuth + has_role check.
    supabase
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setClients(data ?? []);
        setLoading(false);
      });
  }, []);

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background text-ivory">
      <header className="border-b border-gold/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-display text-xl">
            Panova<span className="text-gold">PRO</span>
            <span className="ml-2 text-xs uppercase tracking-widest text-gold">Admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="text-sm text-warm-gray transition-colors hover:text-ivory"
            >
              Мой кабинет
            </Link>
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
        <p className="eyebrow">Админ-панель</p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl">Клиенты</h1>
        <p className="mt-3 text-warm-gray">
          Список зарегистрированных клиентов. Полное управление появится в следующих фазах.
        </p>

        <div className="mt-10 overflow-hidden rounded-3xl border border-gold/15">
          <table className="w-full text-left">
            <thead className="bg-surface/50 text-xs uppercase tracking-wider text-warm-gray">
              <tr>
                <th className="px-6 py-4">Имя</th>
                <th className="px-6 py-4">Телефон</th>
                <th className="px-6 py-4">Зарегистрирован</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-warm-gray">
                    Загрузка...
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-warm-gray">
                    Пока нет данных
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.id} className="text-sm">
                    <td className="px-6 py-4 text-ivory">{c.full_name || "—"}</td>
                    <td className="px-6 py-4 text-warm-gray">{c.phone || "—"}</td>
                    <td className="px-6 py-4 text-warm-gray">
                      {new Date(c.created_at).toLocaleDateString("ru-RU")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

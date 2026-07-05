import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "client";
export type AccessStatus = "pending_onboarding" | "awaiting_approval" | "active" | "suspended";

type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  accessStatus: AccessStatus | null;
  loading: boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAccess = useCallback(async () => {
    if (!session) return;
    const s = await fetchAccess(session.user.id);
    setAccessStatus(s);
  }, [session]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setRole(null);
        setAccessStatus(null);
        return;
      }
      setTimeout(() => {
        void fetchRole(s.user.id).then(setRole);
        void fetchAccess(s.user.id).then(setAccessStatus);
      }, 0);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        void Promise.all([
          fetchRole(data.session.user.id).then(setRole),
          fetchAccess(data.session.user.id).then(setAccessStatus),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, role, accessStatus, loading, refreshAccess, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function fetchRole(userId: string): Promise<AppRole | null> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.role as AppRole;
}

async function fetchAccess(userId: string): Promise<AccessStatus | null> {
  const { data, error } = await supabase
    .from("client_access")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.status as AccessStatus;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

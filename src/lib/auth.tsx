import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "client";
export type AccessStatus = "pending_onboarding" | "awaiting_approval" | "active" | "suspended";
export type UnlockSource = "promo" | "payment" | null;

export type Impersonation = { userId: string; name: string } | null;

type AccessInfo = {
  status: AccessStatus;
  unlockSource: UnlockSource;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  accessStatus: AccessStatus | null;
  unlockSource: UnlockSource;
  loading: boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
  impersonation: Impersonation;
  startImpersonation: (userId: string, name: string) => void;
  stopImpersonation: () => void;
  effectiveUserId: string | null;
  effectiveRole: AppRole | null;
  effectiveAccessStatus: AccessStatus | null;
  effectiveUnlockSource: UnlockSource;
};

const AuthContext = createContext<AuthState | undefined>(undefined);
const IMPERSONATION_KEY = "panovapro.impersonation";

function readStoredImpersonation(): Impersonation {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.userId === "string") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** Registration + questionnaire unlocked; full course still needs status=active */
export function isEnrollmentUnlocked(
  status: AccessStatus | null,
  unlockSource: UnlockSource,
  role: AppRole | null,
): boolean {
  if (role === "admin") return true;
  if (status === "active" || status === "awaiting_approval") return true;
  return unlockSource === "promo" || unlockSource === "payment";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [unlockSource, setUnlockSource] = useState<UnlockSource>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<Impersonation>(() => readStoredImpersonation());
  const [impersonatedAccess, setImpersonatedAccess] = useState<AccessInfo | null>(null);

  const applyAccess = useCallback((info: AccessInfo) => {
    setAccessStatus(info.status);
    setUnlockSource(info.unlockSource);
  }, []);

  const refreshAccess = useCallback(async () => {
    if (!session) return;
    const info = await fetchAccess(session.user.id);
    applyAccess(info);
    if (impersonation) {
      setImpersonatedAccess(await fetchAccess(impersonation.userId));
    }
  }, [session, impersonation, applyAccess]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setRole(null);
        setAccessStatus(null);
        setUnlockSource(null);
        setImpersonation(null);
        setImpersonatedAccess(null);
        if (typeof window !== "undefined") window.localStorage.removeItem(IMPERSONATION_KEY);
        return;
      }
      setTimeout(() => {
        void fetchRole(s.user.id).then(setRole);
        void fetchAccess(s.user.id).then(applyAccess);
      }, 0);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        void Promise.all([
          fetchRole(data.session.user.id).then(setRole),
          fetchAccess(data.session.user.id).then(applyAccess),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [applyAccess]);

  useEffect(() => {
    if (!impersonation) {
      setImpersonatedAccess(null);
      return;
    }
    void fetchAccess(impersonation.userId).then(setImpersonatedAccess);
  }, [impersonation]);

  const startImpersonation = useCallback((userId: string, name: string) => {
    const value: Impersonation = { userId, name };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(value));
    }
    setImpersonation(value);
  }, []);

  const stopImpersonation = useCallback(() => {
    if (typeof window !== "undefined") window.localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonation(null);
    setImpersonatedAccess(null);
  }, []);

  const signOut = async () => {
    stopImpersonation();
    await supabase.auth.signOut();
  };

  const activeImpersonation = role === "admin" ? impersonation : null;

  const effectiveUserId = activeImpersonation?.userId ?? session?.user?.id ?? null;
  const effectiveRole: AppRole | null = activeImpersonation ? "client" : role;
  const effectiveAccessStatus: AccessStatus | null = activeImpersonation
    ? impersonatedAccess?.status ?? null
    : accessStatus;
  const effectiveUnlockSource: UnlockSource = activeImpersonation
    ? impersonatedAccess?.unlockSource ?? null
    : unlockSource;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        accessStatus,
        unlockSource,
        loading,
        refreshAccess,
        signOut,
        impersonation: activeImpersonation,
        startImpersonation,
        stopImpersonation,
        effectiveUserId,
        effectiveRole,
        effectiveAccessStatus,
        effectiveUnlockSource,
      }}
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

async function fetchAccess(userId: string): Promise<AccessInfo> {
  const { data, error } = await supabase
    .from("client_access")
    .select("status, unlock_source")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { status: "pending_onboarding", unlockSource: null };
  }
  if (data?.status) {
    return {
      status: data.status as AccessStatus,
      unlockSource: (data.unlock_source as UnlockSource) ?? null,
    };
  }

  const { error: insertError } = await supabase.from("client_access").insert({
    user_id: userId,
    status: "pending_onboarding",
  });
  if (insertError) {
    return { status: "pending_onboarding", unlockSource: null };
  }
  return { status: "pending_onboarding", unlockSource: null };
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

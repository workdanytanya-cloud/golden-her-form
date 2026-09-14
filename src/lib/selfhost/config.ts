export type AuthBackend = "supabase" | "local";
export type DataBackend = "supabase" | "postgres";
export type MediaBackend = "supabase" | "local-links";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function getAuthBackend(): AuthBackend {
  return readEnv("AUTH_BACKEND") === "local" ? "local" : "supabase";
}

export function getDataBackend(): DataBackend {
  return readEnv("DATA_BACKEND") === "postgres" ? "postgres" : "supabase";
}

export function getMediaBackend(): MediaBackend {
  const explicit = readEnv("MEDIA_BACKEND");
  if (explicit === "local-links" || explicit === "supabase") return explicit;
  return getDataBackend() === "postgres" ? "local-links" : "supabase";
}

export function isLocalClientCircuit(): boolean {
  return getAuthBackend() === "local" && getDataBackend() === "postgres";
}

export function isLocalLinksMedia(): boolean {
  return isLocalClientCircuit() && getMediaBackend() === "local-links";
}

export function requireDatabaseUrl(): string {
  const url = readEnv("DATABASE_URL");
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. При DATA_BACKEND=postgres облако Supabase не используется как запасной вариант.",
    );
  }
  return url;
}

export function sessionCookieName(): string {
  return "panovapro_session";
}

export function csrfCookieName(): string {
  return "panovapro_csrf";
}

export function sessionTtlMs(): number {
  return 14 * 24 * 60 * 60 * 1000;
}

export function isProduction(): boolean {
  return readEnv("NODE_ENV") === "production";
}

export function sessionCookieSecure(): boolean {
  const explicit = readEnv("SESSION_COOKIE_SECURE");
  if (explicit === "0" || explicit === "false") return false;
  if (explicit === "1" || explicit === "true") return true;
  return isProduction();
}

export type RuntimePublicConfig = {
  authBackend: AuthBackend;
  dataBackend: DataBackend;
  mediaBackend: MediaBackend;
};

export function publicRuntimeConfig(): RuntimePublicConfig {
  return {
    authBackend: getAuthBackend(),
    dataBackend: getDataBackend(),
    mediaBackend: getMediaBackend(),
  };
}

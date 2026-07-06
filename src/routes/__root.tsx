import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "../lib/auth";
import { supabase } from "../integrations/supabase/client";
import { Toaster } from "../components/ui/sonner";
import { ScrollToTop } from "../components/ui/ScrollToTop";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-4 font-display text-5xl text-ivory">Страница не найдена</h1>
        <p className="mt-3 text-sm text-warm-gray">
          Возможно, страница была перемещена. Вернитесь на главную.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-medium tracking-wide text-background transition-transform hover:scale-[1.02]"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl text-ivory">Что-то пошло не так</h1>
        <p className="mt-3 text-sm text-warm-gray">
          Попробуйте обновить страницу или вернуться на главную.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            Попробовать снова
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-gold/40 px-6 py-3 text-sm font-medium text-ivory transition-colors hover:bg-gold/10"
          >
            На главную
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PanovaPRO — Татьяна Панова · Персональный фитнес-коучинг" },
      {
        name: "description",
        content:
          "Татьяна Панова — фитнес-тренер и наставник с опытом 15+ лет. 10 000+ подопечных, авторская система похудения без срывов и голодовок.",
      },
      { name: "author", content: "PanovaPRO · Татьяна Панова" },
      { property: "og:title", content: "PanovaPRO — Татьяна Панова · Персональный фитнес-коучинг" },
      {
        property: "og:description",
        content:
          "Авторская система похудения. 17+ лет в фитнесе, 15+ лет в тренерстве, 10 000+ подопечных.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#0B0A08" },
      { name: "twitter:title", content: "PanovaPRO — Татьяна Панова · Персональный фитнес-коучинг" },
      { name: "description", content: "Авторская система похудения от Татьяны Пановой. 15+ лет тренерства, 10 000+ подопечных. Без срывов и голодовок." },
      { property: "og:description", content: "Авторская система похудения от Татьяны Пановой. 15+ лет тренерства, 10 000+ подопечных. Без срывов и голодовок." },
      { name: "twitter:description", content: "Авторская система похудения от Татьяны Пановой. 15+ лет тренерства, 10 000+ подопечных. Без срывов и голодовок." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/92c4b0bf-dde0-4528-9299-67144c9da9ef" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/92c4b0bf-dde0-4528-9299-67144c9da9ef" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

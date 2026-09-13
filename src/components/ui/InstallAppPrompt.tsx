import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Soft reminder to add site to home screen — only when user chose
 * «Напомнить позже» after signup (panovapro.pendingInstall).
 */
export function InstallAppPrompt({ onClose }: { onClose?: () => void }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem("panovapro.installDismissed") === "1") return;
    if (localStorage.getItem("panovapro.pendingInstall") !== "1") return;

    const ua = window.navigator.userAgent;
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIos(ios);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const path = window.location.pathname;
    const onCabinet =
      path === "/dashboard" ||
      path === "/dashboard/" ||
      path.startsWith("/dashboard/");
    // Don't cover the long onboarding form
    const onOnboarding = path.includes("/onboarding");
    let t: number | undefined;
    if (onCabinet && !onOnboarding) {
      t = window.setTimeout(() => setVisible(true), 1500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      if (t) window.clearTimeout(t);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem("panovapro.installDismissed", "1");
    localStorage.removeItem("panovapro.pendingInstall");
    setVisible(false);
    onClose?.();
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] p-4 sm:p-6">
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-gold/30 bg-background/95 p-4 shadow-2xl backdrop-blur sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[0.65rem]">Быстрый доступ</p>
          <p className="mt-1 font-display text-lg text-ivory">Добавить сайт на рабочий стол</p>
          {isIos ? (
            <p className="mt-2 text-sm leading-relaxed text-warm-gray">
              Нажмите <Share className="mx-0.5 inline h-3.5 w-3.5 text-gold" /> «Поделиться» → «На
              экран „Домой“». Сайт откроется как приложение, без поиска в браузере.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-warm-gray">
              Ярлык на телефоне или компьютере — вход в кабинет в один тап.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {!isIos && deferred && (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-full bg-gold px-4 py-2 text-sm font-medium text-background"
              >
                Добавить
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full border border-gold/30 px-4 py-2 text-sm text-ivory"
            >
              Позже
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={dismiss}
          className="rounded-lg p-1 text-warm-gray hover:text-ivory"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

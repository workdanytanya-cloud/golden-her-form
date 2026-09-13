import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, MonitorSmartphone, Share, Smartphone } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | "desktop";

type Props = {
  email: string;
  password: string;
  fullName?: string;
  onDone: () => void;
};

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "desktop";
  const ua = window.navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

async function tryStorePassword(email: string, password: string, fullName?: string) {
  try {
    // Chromium: Password Credential Management API
    const PasswordCredentialCtor = (
      window as unknown as {
        PasswordCredential?: new (data: {
          id: string;
          password: string;
          name?: string;
        }) => Credential;
      }
    ).PasswordCredential;
    if (!PasswordCredentialCtor || !navigator.credentials?.store) return false;
    const cred = new PasswordCredentialCtor({
      id: email,
      password,
      name: fullName || email,
    });
    await navigator.credentials.store(cred);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two-step guide after registration: save password → add to home screen.
 */
export function PostSignupGuide({ email, password, fullName, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [passwordStored, setPasswordStored] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    void tryStorePassword(email, password, fullName).then((ok) => {
      if (ok) setPasswordStored(true);
    });

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, [email, password, fullName]);

  const finish = () => {
    try {
      localStorage.setItem("panovapro.installDismissed", "1");
      localStorage.removeItem("panovapro.pendingInstall");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const laterInstall = () => {
    try {
      localStorage.setItem("panovapro.pendingInstall", "1");
      localStorage.removeItem("panovapro.installDismissed");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const installNative = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    finish();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-background/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-signup-title"
        className="w-full max-w-md rounded-3xl border border-gold/25 bg-surface p-6 shadow-2xl sm:p-8"
      >
        <p className="text-[11px] uppercase tracking-widest text-gold">
          Шаг {step} из 2
        </p>

        {step === 1 ? (
          <>
            <h2 id="post-signup-title" className="mt-2 font-display text-2xl text-ivory">
              Сохраните пароль в браузере
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-warm-gray">
              Если браузер предложит сохранить пароль — нажмите{" "}
              <span className="text-ivory">«Сохранить»</span>. Так вы не будете вводить его при
              каждом входе.
            </p>
            {passwordStored ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-gold">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Запрос на сохранение отправлен браузеру
              </p>
            ) : (
              <p className="mt-3 text-sm text-warm-gray">
                Подсказка обычно появляется вверху или внизу окна браузера сразу после регистрации.
              </p>
            )}
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-6 w-full rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
            >
              Далее
            </button>
          </>
        ) : (
          <>
            <h2 id="post-signup-title" className="mt-2 font-display text-2xl text-ivory">
              Добавьте сайт на рабочий стол
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-warm-gray">
              Ярлык откроет кабинет в один тап — без ввода адреса в строке браузера.
            </p>

            <div className="mt-4 rounded-2xl border border-gold/15 bg-background/40 p-4 text-sm text-warm-gray">
              {platform === "ios" && (
                <ol className="list-decimal space-y-2 pl-4 leading-relaxed">
                  <li className="text-ivory/90">
                    Нажмите{" "}
                    <Share className="mx-0.5 inline h-3.5 w-3.5 text-gold" aria-hidden />{" "}
                    <span className="text-ivory">«Поделиться»</span> внизу Safari
                  </li>
                  <li className="text-ivory/90">
                    Пролистайте меню и выберите{" "}
                    <span className="text-ivory">«На экран „Домой“»</span>
                  </li>
                  <li className="text-ivory/90">
                    Нажмите <span className="text-ivory">«Добавить»</span>
                  </li>
                </ol>
              )}
              {platform === "android" && (
                <ol className="list-decimal space-y-2 pl-4 leading-relaxed">
                  <li className="text-ivory/90">
                    Нажмите кнопку <span className="text-ivory">«Добавить»</span> ниже — или меню{" "}
                    <span className="text-ivory">⋮</span> →{" "}
                    <span className="text-ivory">«Установить приложение»</span> /{" "}
                    <span className="text-ivory">«На главный экран»</span>
                  </li>
                  <li className="text-ivory/90">Подтвердите установку ярлыка</li>
                </ol>
              )}
              {platform === "desktop" && (
                <ol className="list-decimal space-y-2 pl-4 leading-relaxed">
                  <li className="text-ivory/90">
                    В адресной строке нажмите значок установки{" "}
                    <MonitorSmartphone className="mx-0.5 inline h-3.5 w-3.5 text-gold" aria-hidden />{" "}
                    или меню браузера →{" "}
                    <span className="text-ivory">«Установить PanovaPRO»</span>
                  </li>
                  <li className="text-ivory/90">
                    Либо создайте ярлык: меню →{" "}
                    <span className="text-ivory">«Создать ярлык»</span> /{" "}
                    <span className="text-ivory">«Добавить на рабочий стол»</span>
                  </li>
                </ol>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {deferred && (
                <button
                  type="button"
                  onClick={() => void installNative()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
                >
                  <Smartphone className="h-4 w-4" />
                  Добавить на рабочий стол
                </button>
              )}
              <button
                type="button"
                onClick={finish}
                className={[
                  "w-full rounded-full px-6 py-3.5 text-sm font-medium transition-transform hover:scale-[1.02]",
                  deferred
                    ? "border border-gold/30 text-ivory"
                    : "bg-gold text-background",
                ].join(" ")}
              >
                {deferred ? "Уже добавила / Готово" : "Понятно, перейти в кабинет"}
              </button>
              <button
                type="button"
                onClick={laterInstall}
                className="w-full py-2 text-center text-xs text-warm-gray hover:text-ivory"
              >
                Напомнить позже
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

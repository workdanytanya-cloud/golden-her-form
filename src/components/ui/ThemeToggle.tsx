import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const hint = isDark ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={hint}
            title={hint}
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-ivory transition-colors hover:bg-gold/15 hover:text-gold",
              className,
            ].join(" ")}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-surface text-ivory border border-gold/20">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

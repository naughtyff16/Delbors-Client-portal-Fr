import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, OctagonAlert, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: ToastTone; title: string; body?: string }
const Ctx = createContext<(tone: ToastTone, title: string, body?: string) => void>(() => {});

// Time on screen follows the amount of text (about 220 words a minute), with a floor so short confirmations still register.
const readMs = (tone: ToastTone, text: string) => Math.min(12000, Math.max(tone === 'error' ? 7000 : 4000, 1500 + text.trim().split(/\s+/).length * 280));

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastTone, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, title, body }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), readMs(tone, `${title} ${body ?? ''}`));
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-pop items-start gap-3 rounded-2xl bg-surface p-4 shadow-pop">
            {t.tone === 'success' ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : t.tone === 'error' ? <OctagonAlert className="size-5 shrink-0 text-danger" /> : <Info className="size-5 shrink-0 text-info" />}
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{t.title}</p>{t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}</div>
            <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="relative shrink-0 rounded-full text-muted transition-colors before:absolute before:-inset-3 hover:text-ink" aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return { success: (t: string, b?: string) => push('success', t, b), error: (t: string, b?: string) => push('error', t, b), info: (t: string, b?: string) => push('info', t, b) };
}

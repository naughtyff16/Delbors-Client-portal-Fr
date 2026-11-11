// Runtime configuration loaded from /app-config.json (same origin — no CDN, no rebuild needed).
// Edit that file after deployment to link the Staff app and the Portal to each other.
/** showDemoLogins: show the demo password / sample accounts on the sign-in pages. Set false (or omit) for production. */
export interface AppConfig { appName?: string; portalUrl?: string; staffUrl?: string; apiBaseUrl?: string; showDemoLogins?: boolean; /** Temporary change-log page in both apps (CHANGELOG-REMOVE). */ showChangeLog?: boolean }

let cached: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  cached ??= fetch('/app-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : {}))
    .catch(() => ({}));
  return cached;
}

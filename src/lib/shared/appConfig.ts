// Runtime configuration loaded from /app-config.json (same origin — no CDN, no rebuild needed).
// Edit that file after deployment to link the Staff app and the Portal to each other.
/** showDemoLogins: show the demo password / sample accounts on the sign-in pages. Set false (or omit) for production. */
export interface AppConfig { appName?: string; portalUrl?: string; staffUrl?: string; apiBaseUrl?: string; showDemoLogins?: boolean; /** Temporary change-log page in both apps (CHANGELOG-REMOVE). */ showChangeLog?: boolean;
  /**
   * Portal review (production contact details): the approved support contacts for the release. When set, they replace the
   * System-settings values on the sign-in page, the portal footer, restriction messages and the privacy notice — no rebuild needed.
   */
  releaseContacts?: ReleaseContacts }
export interface ReleaseContacts { client?: { phone?: string; email?: string }; vendor?: { phone?: string; email?: string }; dpoEmail?: string;
  /** Delbros account clients pay into (e-wallet top-ups, invoice payments) — shown on the E-wallet page and the top-up dialog. */
  payee?: { bank: string; accountName: string; accountNo: string; branch?: string } }
let cached: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  cached ??= fetch('/app-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : {}))
    .catch(() => ({}));
  return cached;
}

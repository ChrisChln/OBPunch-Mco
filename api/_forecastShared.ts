import { createClient } from '@supabase/supabase-js';

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl =
  (process.env.SUPABASE_URL as string | undefined) ??
  (!isProduction ? ((process.env.VITE_SUPABASE_URL as string | undefined) ?? undefined) : undefined);
const supabaseServiceRoleKey =
  (process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined);
const adminToken = process.env.ADMIN_TOKEN as string | undefined;
const cronSecret = process.env.CRON_SECRET as string | undefined;

export const DEFAULT_TIMEZONE = 'America/New_York';
export const DEFAULT_CODE_VERSION =
  (process.env.VERCEL_GIT_COMMIT_SHA as string | undefined) ??
  (process.env.COMMIT_SHA as string | undefined) ??
  'local';

export const createServiceSupabase = () => {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return createClient(supabaseUrl, supabaseServiceRoleKey);
};

export const ensureAdmin = (req: any, res: any) => {
  const authHeader = (req.headers?.authorization as string | undefined) ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!adminToken || token !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

export const ensureCron = (req: any, res: any) => {
  const authHeader = (req.headers?.authorization as string | undefined) ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (adminToken && token === adminToken) return true;
  if (cronSecret && token === cronSecret) return true;
  const userAgent = String(req.headers?.['user-agent'] ?? '').toLowerCase();
  const isCronRequest = req.headers?.['x-vercel-cron'] === '1' || userAgent.includes('vercel-cron');

  if (!isCronRequest) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

export const parseJsonBody = <T>(req: any, res: any): T | null => {
  try {
    return (typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')) as T;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return null;
  }
};

export const toDateOnlyNy = (value: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);

export const addDaysDateOnly = (dateOnly: string, shift: number) => {
  const next = new Date(`${dateOnly}T00:00:00`);
  next.setDate(next.getDate() + shift);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    String(next.getDate()).padStart(2, '0')
  ].join('-');
};

export const getDefaultTargetDate = (shift: number) => addDaysDateOnly(toDateOnlyNy(new Date()), shift);

export const isDateOnly = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

export const asNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const safeJson = (value: unknown) => {
  if (value && typeof value === 'object') return value;
  return {};
};

export const loadForecastSetting = async (supabase: any, key: string) => {
  const res = await supabase.from('ob_app_settings').select('value').eq('key', key).limit(1).maybeSingle();
  if (res.error) return null;
  return res.data?.value ?? null;
};

export const readThresholds = async (supabase: any) => {
  const raw = safeJson(await loadForecastSetting(supabase, 'forecast_metric_thresholds'));
  return {
    recent14Wape: asNumber((raw as any).recent14_wape) ?? 0.08,
    p90AbsVariance: asNumber((raw as any).p90_abs_variance) ?? 0.1,
    within3Floor: asNumber((raw as any).within3_floor) ?? 0.6,
    worstDay: asNumber((raw as any).worst_day) ?? 0.15
  };
};

export const readEnabledModels = async (supabase: any) => {
  const raw = await loadForecastSetting(supabase, 'forecast_enabled_models');
  return Array.isArray(raw) ? raw.map((item) => String(item ?? '').trim()).filter(Boolean) : null;
};

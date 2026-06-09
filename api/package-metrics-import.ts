import { createClient } from '@supabase/supabase-js';
import { createServiceSupabase, parseJsonBody } from './_forecastShared.js';
import { isDateOnly, type PackageMetricsParsedRow } from '../src/shared/packageMetrics.js';
import { getModuleMapFromContext, hasModuleAccess, normalizeAdminAccessContext } from '../src/shared/adminAccess.js';
import { processPackageMetricsImport, processPackageMetricsRowsImport } from './_packageMetricsImportCore.js';
import { computeScheduledHeadcountForDate } from './_packageStaffingSync.js';

type PackageMetricsImportBody = {
  metric_date?: string;
  filename?: string;
  file_base64?: string;
  rows?: PackageMetricsParsedRow[];
};

const applyDevCorsHeaders = (req: any, res: any) => {
  const origin = String(req.headers?.origin ?? '');
  if (!/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const loadForecastInventoryQty = async (supabase: any, metricDate: string) => {
  const inventoryRes = await supabase
    .from('volume_forecast_daily_inputs')
    .select('inventory_level')
    .eq('input_date', metricDate)
    .maybeSingle();

  if (inventoryRes.error) {
    throw new Error(String(inventoryRes.error.message ?? 'Failed to load forecast inventory.'));
  }

  const rawInventory = inventoryRes.data?.inventory_level;
  if (rawInventory == null) return null;
  const inventoryQty = Number(rawInventory);
  return Number.isFinite(inventoryQty) && inventoryQty >= 0 ? inventoryQty : null;
};

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl =
  (process.env.SUPABASE_URL as string | undefined) ??
  (!isProduction ? ((process.env.VITE_SUPABASE_URL as string | undefined) ?? undefined) : undefined);
const supabaseAnonKey =
  (process.env.SUPABASE_ANON_KEY as string | undefined) ??
  (process.env.VITE_SUPABASE_ANON_KEY as string | undefined);

const createUserSupabase = (token: string) => {
  if (!supabaseUrl || !supabaseAnonKey || !token) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
};

const ensureAuthenticatedUser = async (req: any, res: any, supabase: any) => {
  const authHeader = String(req.headers?.authorization ?? '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return { user: userRes.data.user, token };
};

export default async function handler(req: any, res: any) {
  applyDevCorsHeaders(req, res);

  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const supabase = createServiceSupabase();
    if (!supabase) {
      res.status(500).json({ error: 'Missing Supabase server configuration' });
      return;
    }

    const auth = await ensureAuthenticatedUser(req, res, supabase);
    if (!auth) return;

    const userSupabase = createUserSupabase(auth.token);
    if (!userSupabase) {
      res.status(500).json({ error: 'Missing Supabase client configuration' });
      return;
    }

    const accessRes = await userSupabase.rpc('get_admin_access_context');
    if (accessRes.error) {
      res.status(403).json({ error: 'Failed to verify package metrics permission.' });
      return;
    }

    const accessContext = normalizeAdminAccessContext(accessRes.data, auth.user.email ?? null);
    const moduleMap = getModuleMapFromContext(accessContext);
    if (!hasModuleAccess(moduleMap, 'package_metrics', 'operate')) {
      res.status(403).json({ error: 'Package metrics operate permission is required.' });
      return;
    }

    const body = parseJsonBody<PackageMetricsImportBody>(req, res);
    if (!body) return;

    const metricDate = String(body.metric_date ?? '').trim();
    const filename = String(body.filename ?? '').trim();
    const fileBase64 = String(body.file_base64 ?? '').trim();
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!isDateOnly(metricDate)) {
      res.status(400).json({ error: 'metric_date must use YYYY-MM-DD.' });
      return;
    }
    if (!filename) {
      res.status(400).json({ error: 'filename is required.' });
      return;
    }
    if ((!rows || rows.length === 0) && !fileBase64) {
      res.status(400).json({ error: 'rows or file_base64 is required.' });
      return;
    }

    try {
      const inventoryQty = await loadForecastInventoryQty(supabase, metricDate);
      const persistence = {
        insertRun: async (payload: any) => {
          const insertRes = await supabase
            .from('ob_package_import_runs')
            .insert(payload)
            .select('id')
            .single();
          if (insertRes.error) throw insertRes.error;
          return { id: String(insertRes.data?.id ?? '') };
        },
        updateRun: async (id: string, payload: any) => {
          const updateRes = await supabase.from('ob_package_import_runs').update(payload).eq('id', id);
          if (updateRes.error) throw updateRes.error;
        },
        upsertMetrics: async (payload: any) => {
          const scheduledHeadcount = await computeScheduledHeadcountForDate(supabase, metricDate);
          const upsertRes = await supabase.from('ob_package_daily_metrics').upsert(
            {
              ...payload,
              scheduled_headcount: scheduledHeadcount,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'metric_date' }
          );
          if (upsertRes.error) throw upsertRes.error;
        }
      };

      const result =
        rows && rows.length > 0
          ? await processPackageMetricsRowsImport(
              {
                metricDate,
                filename,
                rows,
                inventoryQty
              },
              persistence
            )
          : await processPackageMetricsImport(
              {
                metricDate,
                filename,
                fileBase64,
                inventoryQty
              },
              persistence
            );

      res.status(200).json({
        status: 'ok',
        ...result
      });
    } catch (error: any) {
      res.status(400).json({ error: String(error?.message ?? error ?? 'Import failed') });
    }
  } catch (error: any) {
    res.status(500).json({ error: String(error?.message ?? error ?? 'Import failed') });
  }
}

import { createClient } from '@supabase/supabase-js';
import { createServiceSupabase, parseJsonBody } from './_forecastShared.js';
import { computePackageTransferRemainderRows, isDateOnly } from '../src/shared/packageMetrics.js';
import { getModuleMapFromContext, hasModuleAccess, normalizeAdminAccessContext } from '../src/shared/adminAccess.js';

const TRANSFER_FIELD_KEYS = [
  'transfer_b2b_inbound_order_count',
  'transfer_b2b_inbound_box_count',
  'transfer_b2b_inbound_item_qty',
  'transfer_b2b_shipped_order_count',
  'transfer_b2b_shipped_box_count',
  'transfer_b2b_shipped_item_qty',
  'transfer_c2b_inbound_order_count',
  'transfer_c2b_inbound_box_count',
  'transfer_c2b_inbound_item_qty',
  'transfer_c2b_shipped_order_count',
  'transfer_c2b_shipped_box_count',
  'transfer_c2b_shipped_item_qty',
  'transfer_whole_day_inbound_box_count',
  'transfer_whole_day_inbound_item_qty',
  'transfer_avg_items_per_box'
] as const;

type TransferFieldKey = (typeof TRANSFER_FIELD_KEYS)[number];

type PackageMetricsTransferBody = {
  metric_date?: string;
  values?: Partial<Record<TransferFieldKey, unknown>>;
  inventory_level?: unknown;
};

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl =
  (process.env.SUPABASE_URL as string | undefined) ??
  (!isProduction ? ((process.env.VITE_SUPABASE_URL as string | undefined) ?? undefined) : undefined);
const supabaseAnonKey =
  (process.env.SUPABASE_ANON_KEY as string | undefined) ??
  (process.env.VITE_SUPABASE_ANON_KEY as string | undefined);

const applyDevCorsHeaders = (req: any, res: any) => {
  const origin = String(req.headers?.origin ?? '');
  if (!/^https?:\/\/localhost(?::\d)?\d*$/i.test(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

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

const normalizeTransferValue = (key: TransferFieldKey, value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }
  if (key === 'transfer_avg_items_per_box') {
    return Number(normalized.toFixed(2));
  }
  if (!Number.isInteger(normalized)) {
    throw new Error(`${key} must be a whole number.`);
  }
  return normalized;
};

const normalizeInventoryLevel = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
    throw new Error('inventory_level must be a non-negative whole number.');
  }
  return normalized;
};

const recalculateTransferRemainders = async (supabase: any, metricDate: string) => {
  const previousRes = await supabase
    .from('ob_package_daily_metrics')
    .select(
      'transfer_b2b_unshipped_order_count,transfer_b2b_unshipped_box_count,transfer_b2b_unshipped_item_qty,transfer_c2b_unshipped_order_count,transfer_c2b_unshipped_box_count,transfer_c2b_unshipped_item_qty'
    )
    .lt('metric_date', metricDate)
    .order('metric_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousRes.error) {
    throw new Error(String(previousRes.error.message ?? 'Failed to load previous transfer remainder.'));
  }

  const rowsRes = await supabase
    .from('ob_package_daily_metrics')
    .select(
      [
        'metric_date',
        'transfer_b2b_inbound_order_count',
        'transfer_b2b_inbound_box_count',
        'transfer_b2b_inbound_item_qty',
        'transfer_b2b_shipped_order_count',
        'transfer_b2b_shipped_box_count',
        'transfer_b2b_shipped_item_qty',
        'transfer_c2b_inbound_order_count',
        'transfer_c2b_inbound_box_count',
        'transfer_c2b_inbound_item_qty',
        'transfer_c2b_shipped_order_count',
        'transfer_c2b_shipped_box_count',
        'transfer_c2b_shipped_item_qty'
      ].join(',')
    )
    .gte('metric_date', metricDate)
    .order('metric_date', { ascending: true });

  if (rowsRes.error) {
    throw new Error(String(rowsRes.error.message ?? 'Failed to load transfer rows.'));
  }

  const updates = computePackageTransferRemainderRows((rowsRes.data ?? []) as any[], {
    b2bOrder: Number(previousRes.data?.transfer_b2b_unshipped_order_count ?? 0),
    b2bBox: Number(previousRes.data?.transfer_b2b_unshipped_box_count ?? 0),
    b2bItem: Number(previousRes.data?.transfer_b2b_unshipped_item_qty ?? 0),
    c2bOrder: Number(previousRes.data?.transfer_c2b_unshipped_order_count ?? 0),
    c2bBox: Number(previousRes.data?.transfer_c2b_unshipped_box_count ?? 0),
    c2bItem: Number(previousRes.data?.transfer_c2b_unshipped_item_qty ?? 0)
  }).map((row) => ({
    ...row,
    updated_at: new Date().toISOString()
  }));

  if (updates.length === 0) return null;

  const updateRes = await supabase.from('ob_package_daily_metrics').upsert(updates, { onConflict: 'metric_date' });
  if (updateRes.error) {
    throw new Error(String(updateRes.error.message ?? 'Failed to save transfer remainders.'));
  }

  const currentRes = await supabase.from('ob_package_daily_metrics').select('*').eq('metric_date', metricDate).single();
  if (currentRes.error) {
    throw new Error(String(currentRes.error.message ?? 'Failed to load transfer metrics.'));
  }

  return currentRes.data;
};

export default async function handler(req: any, res: any) {
  applyDevCorsHeaders(req, res);

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

  const body = parseJsonBody<PackageMetricsTransferBody>(req, res);
  if (!body) return;

  const metricDate = String(body.metric_date ?? '').trim();
  if (!isDateOnly(metricDate)) {
    res.status(400).json({ error: 'metric_date must use YYYY-MM-DD.' });
    return;
  }

  try {
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const inventoryLevel = normalizeInventoryLevel(body.inventory_level);
    const payload: Record<string, number | string | null> = {
      metric_date: metricDate,
      updated_at: new Date().toISOString()
    };

    for (const key of TRANSFER_FIELD_KEYS) {
      payload[key] = normalizeTransferValue(key, values[key]);
    }

    if (inventoryLevel != null) {
      payload.inventory_qty = inventoryLevel;
    }

    const upsertRes = await supabase
      .from('ob_package_daily_metrics')
      .upsert(payload, { onConflict: 'metric_date' })
      .select('*')
      .single();

    if (upsertRes.error) {
      throw new Error(String(upsertRes.error.message ?? 'Failed to save transfer data.'));
    }
    let responseMetrics = upsertRes.data;

    if (inventoryLevel != null) {
      const forecastInputRes = await supabase.from('volume_forecast_daily_inputs').upsert(
        {
          input_date: metricDate,
          inventory_level: inventoryLevel,
          updated_by: auth.user.email ?? null
        },
        { onConflict: 'input_date' }
      );

      if (forecastInputRes.error) {
        throw new Error(String(forecastInputRes.error.message ?? 'Failed to save forecast inventory.'));
      }

      const inboundItems = Number(upsertRes.data?.calendar_inbound_item_qty ?? 0);
      const inventoryConversionRatio =
        inventoryLevel > 0 && Number.isFinite(inboundItems) ? Number((inboundItems / inventoryLevel).toFixed(6)) : null;
      const inventorySyncRes = await supabase
        .from('ob_package_daily_metrics')
        .update({
          inventory_qty: inventoryLevel,
          inventory_conversion_ratio: inventoryConversionRatio,
          updated_at: new Date().toISOString()
        })
        .eq('metric_date', metricDate)
        .select('*')
        .single();

      if (inventorySyncRes.error) {
        throw new Error(String(inventorySyncRes.error.message ?? 'Failed to sync package metrics inventory.'));
      }

      responseMetrics = inventorySyncRes.data;
    }

    responseMetrics = (await recalculateTransferRemainders(supabase, metricDate)) ?? responseMetrics;

    res.status(200).json({
      status: 'ok',
      metrics: responseMetrics
    });
  } catch (error: any) {
    res.status(400).json({ error: String(error?.message ?? error ?? 'Failed to save transfer data.') });
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env');
const envText = fs.readFileSync(envPath, 'utf8');

const parseEnv = (text) => {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
  }
  return out;
};

const envPairs = parseEnv(envText);
const getFirst = (key) => envPairs.find(([k]) => k === key)?.[1] ?? '';
const getAll = (key) => envPairs.filter(([k]) => k === key).map(([, v]) => v);

const supabaseUrl = getFirst('VITE_SUPABASE_URL');
const anonKey = getFirst('VITE_SUPABASE_ANON_KEY');

const serviceKeyCandidates = [
  ...getAll('SUPABASE_SERVICE_ROLE_KEY'),
  ...getAll('VITE_SUPABASE_SERVICE_ROLE_KEY'),
  ...getAll('VITE_OBUP_SUPABASE_ANON_KEY')
].filter(Boolean);

const serviceKey = serviceKeyCandidates.find((key) => key.includes('service_role')) ?? serviceKeyCandidates[0] ?? '';

if (!supabaseUrl || !anonKey || !serviceKey) {
  throw new Error('Missing required Supabase credentials in .env');
}

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const ADMIN_MODULE_KEYS = [
  'home',
  'employees',
  'accounts',
  'permissions',
  'timecard',
  'leave_approval',
  'todo',
  'punches',
  'audit',
  'schedule',
  'devices',
  'forecast',
  'prediction_model',
  'efficiency',
  'agency'
];

const print = (label, value) => {
  console.log(`\n[${label}]`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

const buildModules = () =>
  ADMIN_MODULE_KEYS.map((module_key) => ({
    module_key,
    access_level: module_key === 'agency' ? 'operate' : 'hidden'
  }));

let tempAdminUserId = null;
let tempAgencyUserId = null;

try {
  const now = Date.now();
  const email = `perm-check-${now}@example.com`;
  const password = `PermCheck!${now}Aa`;

  const create = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Permission Check Bot' }
  });

  if (create.error || !create.data.user) {
    throw new Error(`Failed to create temp admin user: ${create.error?.message ?? 'unknown error'}`);
  }

  tempAdminUserId = create.data.user.id;

  const grant = await service
    .from('ob_admin_accounts')
    .upsert([{ user_id: tempAdminUserId, role: 'level1', is_active: true, managed_agencies: [] }], {
      onConflict: 'user_id'
    })
    .select('user_id, role, is_active');

  if (grant.error) {
    throw new Error(`Failed to grant temp admin: ${grant.error.message}`);
  }

  const moduleKeysRes = await userClient.rpc('admin_module_keys');
  print('admin_module_keys', moduleKeysRes.error ? { error: moduleKeysRes.error.message } : moduleKeysRes.data);

  const targetRes = await service
    .from('ob_admin_accounts')
    .select('user_id, role, is_active, managed_agencies')
    .eq('role', 'agency')
    .eq('is_active', true)
    .limit(1);

  if (targetRes.error) {
    throw new Error(`Failed to find target account: ${targetRes.error.message}`);
  }

  const target = targetRes.data?.[0];
  if (!target?.user_id) {
    throw new Error('No active agency account found for validation.');
  }

  const signIn = await userClient.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    throw new Error(`Temp admin sign-in failed: ${signIn.error.message}`);
  }

  const before = await userClient.rpc('list_admin_access_accounts');
  if (before.error) {
    throw new Error(`list_admin_access_accounts (before) failed: ${before.error.message}`);
  }

  const beforeRow = (before.data ?? []).find((row) => row.user_id === target.user_id) ?? null;

  const payload = {
    p_user_id: target.user_id,
    p_role: 'agency',
    p_is_active: true,
    p_managed_agencies: target.managed_agencies ?? [],
    p_modules: buildModules()
  };

  const save = await userClient.rpc('save_admin_access_account', payload);
  if (save.error) {
    throw new Error(`save_admin_access_account failed: ${save.error.message}`);
  }

  const after = await userClient.rpc('list_admin_access_accounts');
  if (after.error) {
    throw new Error(`list_admin_access_accounts (after) failed: ${after.error.message}`);
  }

  const afterRow = (after.data ?? []).find((row) => row.user_id === target.user_id) ?? null;

  const rawAgency = await service
    .from('ob_admin_account_modules')
    .select('module_key, access_level')
    .eq('user_id', target.user_id)
    .eq('module_key', 'agency');

  if (rawAgency.error) {
    throw new Error(`Raw module query failed: ${rawAgency.error.message}`);
  }

  const beforeAgency = beforeRow?.modules?.find?.((m) => m?.module_key === 'agency') ?? null;
  const afterAgency = afterRow?.modules?.find?.((m) => m?.module_key === 'agency') ?? null;

  print('target_user_id', target.user_id);
  print('before_agency_from_list_rpc', beforeAgency);
  print('save_response', save.data);
  print('after_agency_from_list_rpc', afterAgency);
  print('raw_agency_from_table', rawAgency.data ?? []);

  const expected = 'operate';
  const actualByList = String(afterAgency?.access_level ?? 'missing');
  const actualByTable = String(rawAgency.data?.[0]?.access_level ?? 'missing');

  print('validation_summary', {
    expected,
    actual_by_list_admin_access_accounts: actualByList,
    actual_by_ob_admin_account_modules: actualByTable,
    pass: actualByList === expected
  });

  const agencyEmail = `agency-check-${now}@example.com`;
  const agencyPassword = `AgencyCheck!${now}Aa`;
  const createAgency = await service.auth.admin.createUser({
    email: agencyEmail,
    password: agencyPassword,
    email_confirm: true,
    user_metadata: { display_name: 'Agency Permission Check Bot' }
  });
  if (createAgency.error || !createAgency.data.user) {
    throw new Error(`Failed to create temp agency user: ${createAgency.error?.message ?? 'unknown error'}`);
  }
  tempAgencyUserId = createAgency.data.user.id;

  const agencySavePayload = {
    p_user_id: tempAgencyUserId,
    p_role: 'agency',
    p_is_active: true,
    p_managed_agencies: ['Central'],
    p_modules: buildModules()
  };
  const grantAgencyAccess = await userClient.rpc('save_admin_access_account', agencySavePayload);
  if (grantAgencyAccess.error) {
    throw new Error(`Failed to grant temp agency access: ${grantAgencyAccess.error.message}`);
  }

  await userClient.auth.signOut();
  const agencySignIn = await userClient.auth.signInWithPassword({ email: agencyEmail, password: agencyPassword });
  if (agencySignIn.error) {
    throw new Error(`Temp agency sign-in failed: ${agencySignIn.error.message}`);
  }

  const agencyContext = await userClient.rpc('get_admin_access_context');
  if (agencyContext.error) {
    throw new Error(`get_admin_access_context failed for temp agency user: ${agencyContext.error.message}`);
  }
  const contextModules = Array.isArray(agencyContext.data?.modules) ? agencyContext.data.modules : [];
  const contextAgency = contextModules.find((m) => m?.module_key === 'agency') ?? null;
  print('agency_context_agency_module', contextAgency);
  print('agency_context_summary', {
    expected: 'operate',
    actual_by_get_admin_access_context: String(contextAgency?.access_level ?? 'missing'),
    pass: String(contextAgency?.access_level ?? 'missing') === 'operate'
  });

  await userClient.auth.signOut();
} catch (error) {
  console.error('\n[validation_error]');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (tempAdminUserId) {
    await service.from('ob_admin_account_modules').delete().eq('user_id', tempAdminUserId);
    await service.from('ob_admin_accounts').delete().eq('user_id', tempAdminUserId);
    await service.auth.admin.deleteUser(tempAdminUserId);
  }
  if (tempAgencyUserId) {
    await service.from('ob_admin_account_modules').delete().eq('user_id', tempAgencyUserId);
    await service.from('ob_admin_accounts').delete().eq('user_id', tempAgencyUserId);
    await service.auth.admin.deleteUser(tempAgencyUserId);
  }
}

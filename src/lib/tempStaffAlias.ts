import { normalizeStaffId } from './staffId';

type RpcResult = {
  data: unknown;
  error: { message?: string | null } | null;
};

type TempStaffAliasClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

type TempStaffAliasRow = {
  staff_id?: string | null;
};

const readErrorMessage = (error: { message?: string | null }, fallback: string) => {
  const message = String(error.message ?? '').trim();
  return message || fallback;
};

export const resolveTempStaffAlias = async (
  supabase: TempStaffAliasClient,
  sourceStaffId: string
): Promise<{ staffId: string | null; error: string | null }> => {
  const source = normalizeStaffId(sourceStaffId);
  if (!source) return { staffId: null, error: null };

  const result = await supabase.rpc('resolve_temp_staff_alias', {
    p_source_temp_staff_id: source
  });

  if (result.error) {
    return {
      staffId: null,
      error: readErrorMessage(result.error, 'Failed to resolve temporary account binding.')
    };
  }

  const rows = Array.isArray(result.data) ? (result.data as TempStaffAliasRow[]) : [];
  const staffId = normalizeStaffId(String(rows[0]?.staff_id ?? ''));
  return { staffId: staffId || null, error: null };
};

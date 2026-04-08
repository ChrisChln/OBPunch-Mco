import type { TodoItemAssignee, TodoItemLink, TodoItemRecord } from './todoShared';

const TODO_ITEM_TABLE = 'ob_todo_items';
const TODO_ASSIGNEE_TABLE = 'ob_todo_item_assignees';
const USER_PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';

type RawTodoRow = {
  id: string;
  template_id: string;
  title: string | null;
  content: string | null;
  due_at: string | null;
  instance_date: string | null;
  delivery_mode: string | null;
  status: string | null;
  creator_user_id: string | null;
  creator_email: string | null;
  creator_display_name: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_display: string | null;
  delete_requested_at: string | null;
  delete_requested_by_user_id: string | null;
  delete_requested_by_display: string | null;
  created_at: string | null;
  updated_at: string | null;
  ob_todo_templates?: {
    recurrence_kind?: string | null;
    recurrence_rule?: any;
    is_active?: boolean | null;
  } | null;
  ob_todo_item_assignees?: Array<{
    id?: string | null;
    assignee_user_id?: string | null;
    assignee_email?: string | null;
    assignee_display_name?: string | null;
  }> | null;
  ob_todo_item_links?: Array<{
    id?: string | null;
    label?: string | null;
    url?: string | null;
    sort_order?: number | null;
  }> | null;
};

const normalizeAssignees = (rows: RawTodoRow['ob_todo_item_assignees']): TodoItemAssignee[] =>
  ((rows ?? []) as NonNullable<RawTodoRow['ob_todo_item_assignees']>)
    .map((item) => ({
      id: String(item.id ?? ''),
      assignee_user_id: String(item.assignee_user_id ?? ''),
      assignee_email: String(item.assignee_email ?? '').trim(),
      assignee_display_name: String(item.assignee_display_name ?? '').trim()
    }))
    .filter((item) => item.id && item.assignee_user_id)
    .sort((a, b) =>
      (a.assignee_display_name || a.assignee_email || a.assignee_user_id).localeCompare(
        b.assignee_display_name || b.assignee_email || b.assignee_user_id,
        'en-US'
      )
    );

const normalizeLinks = (rows: RawTodoRow['ob_todo_item_links']): TodoItemLink[] =>
  ((rows ?? []) as NonNullable<RawTodoRow['ob_todo_item_links']>)
    .map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? '').trim(),
      url: String(item.url ?? '').trim(),
      sort_order: Number(item.sort_order ?? 0)
    }))
    .filter((item) => item.id && item.label && item.url)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'en-US'));

const normalizeItem = (row: RawTodoRow): TodoItemRecord => ({
  id: String(row.id ?? ''),
  template_id: String(row.template_id ?? ''),
  title: String(row.title ?? '').trim(),
  content: String(row.content ?? '').trim(),
  due_at: row.due_at ? String(row.due_at) : null,
  instance_date: row.instance_date ? String(row.instance_date) : null,
  delivery_mode: String(row.delivery_mode ?? 'shared') as TodoItemRecord['delivery_mode'],
  status: String(row.status ?? 'open') as TodoItemRecord['status'],
  creator_user_id: String(row.creator_user_id ?? ''),
  creator_email: String(row.creator_email ?? '').trim(),
  creator_display_name: String(row.creator_display_name ?? '').trim(),
  completed_at: row.completed_at ? String(row.completed_at) : null,
  completed_by_user_id: row.completed_by_user_id ? String(row.completed_by_user_id) : null,
  completed_by_display: row.completed_by_display ? String(row.completed_by_display).trim() : null,
  delete_requested_at: row.delete_requested_at ? String(row.delete_requested_at) : null,
  delete_requested_by_user_id: row.delete_requested_by_user_id ? String(row.delete_requested_by_user_id) : null,
  delete_requested_by_display: row.delete_requested_by_display ? String(row.delete_requested_by_display).trim() : null,
  recurrence_kind: String(row.ob_todo_templates?.recurrence_kind ?? 'none') as TodoItemRecord['recurrence_kind'],
  recurrence_rule: (row.ob_todo_templates?.recurrence_rule ?? {}) as TodoItemRecord['recurrence_rule'],
  is_template_active: Boolean(row.ob_todo_templates?.is_active ?? true),
  created_at: String(row.created_at ?? ''),
  updated_at: String(row.updated_at ?? ''),
  assignees: normalizeAssignees(row.ob_todo_item_assignees),
  links: normalizeLinks(row.ob_todo_item_links)
});

const TODO_ITEM_SELECT = `
  id,
  template_id,
  title,
  content,
  due_at,
  instance_date,
  delivery_mode,
  status,
  creator_user_id,
  creator_email,
  creator_display_name,
  ob_todo_templates (
    recurrence_kind,
    recurrence_rule,
    is_active
  ),
  completed_at,
  completed_by_user_id,
  completed_by_display,
  delete_requested_at,
  delete_requested_by_user_id,
  delete_requested_by_display,
  created_at,
  updated_at,
  ob_todo_item_assignees (
    id,
    assignee_user_id,
    assignee_email,
    assignee_display_name
  ),
  ob_todo_item_links (
    id,
    label,
    url,
    sort_order
  )
`;

export const fetchTodoProfiles = async (supabase: any) => {
  const normalizeProfiles = (rows: Array<{ user_id?: string | null; user_email?: string | null; display_name?: string | null }>) =>
    rows
      .map((item) => ({
        user_id: String(item.user_id ?? ''),
        user_email: String(item.user_email ?? '').trim(),
        display_name: String(item.display_name ?? '').trim()
      }))
      .filter((item) => item.user_id && item.user_email);

  const rpcRes = await supabase.rpc('list_todo_profiles');
  if (!rpcRes.error) {
    return normalizeProfiles((rpcRes.data ?? []) as Array<{ user_id?: string | null; user_email?: string | null; display_name?: string | null }>);
  }

  const rpcMissing = String(rpcRes.error?.code ?? '') === 'PGRST202';
  if (!rpcMissing) {
    throw new Error(String(rpcRes.error?.message ?? 'Failed to load user profiles.'));
  }

  const res = await supabase.from(USER_PROFILE_TABLE).select('user_id, user_email, display_name').order('display_name', { ascending: true }).limit(5000);
  if (res.error) throw new Error(String(res.error.message ?? 'Failed to load user profiles.'));
  return normalizeProfiles((res.data ?? []) as Array<{ user_id?: string | null; user_email?: string | null; display_name?: string | null }>);
};

export const fetchAssignedTodoItems = async (supabase: any, userId: string) => {
  const res = await supabase
    .from(TODO_ITEM_TABLE)
    .select(TODO_ITEM_SELECT)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (res.error) throw new Error(String(res.error.message ?? 'Failed to load assigned tasks.'));
  return ((res.data ?? []) as RawTodoRow[])
    .map(normalizeItem)
    .filter((item) =>
      item.delivery_mode === 'shared'
        ? item.assignees.some((assignee) => assignee.assignee_user_id === userId)
        : true
    );
};

export const fetchCreatedTodoItems = async (supabase: any, userId: string) => {
  const res = await supabase
    .from(TODO_ITEM_TABLE)
    .select(TODO_ITEM_SELECT)
    .eq('creator_user_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (res.error) throw new Error(String(res.error.message ?? 'Failed to load created tasks.'));
  return ((res.data ?? []) as RawTodoRow[]).map(normalizeItem);
};

export const fetchPendingDeleteTodoItems = async (supabase: any, userId: string) => {
  const res = await supabase
    .from(TODO_ITEM_TABLE)
    .select(TODO_ITEM_SELECT)
    .eq('creator_user_id', userId)
    .eq('status', 'pending_delete')
    .order('delete_requested_at', { ascending: false });
  if (res.error) throw new Error(String(res.error.message ?? 'Failed to load pending delete tasks.'));
  return ((res.data ?? []) as RawTodoRow[]).map(normalizeItem);
};

export const fetchTodoNavPendingCount = async (supabase: any, userId: string) => {
  const assignedRes = await supabase
    .from(TODO_ASSIGNEE_TABLE)
    .select(`item_id, ${TODO_ITEM_TABLE}!inner(status)`, { count: 'exact', head: true })
    .eq('assignee_user_id', userId)
    .eq(`${TODO_ITEM_TABLE}.status`, 'open');
  if (assignedRes.error) throw new Error(String(assignedRes.error.message ?? 'Failed to load todo counts.'));

  const pendingDeleteRes = await supabase
    .from(TODO_ITEM_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('creator_user_id', userId)
    .eq('status', 'pending_delete');
  if (pendingDeleteRes.error) throw new Error(String(pendingDeleteRes.error.message ?? 'Failed to load todo counts.'));

  return Number(assignedRes.count ?? 0) + Number(pendingDeleteRes.count ?? 0);
};

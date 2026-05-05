import { useEffect, useMemo, useState } from 'react';
import {
  TODO_UPDATED_EVENT,
  getTodoInstanceDateFromDueAt,
  isValidTodoUrl,
  normalizeTodoAssignees,
  normalizeTodoLinks,
  type TodoAssigneeInput,
  type TodoDeliveryMode,
  type TodoItemRecord,
  type TodoLinkInput,
  type TodoMonthlyNthWeekday,
  type TodoRecurrenceKind,
  type TodoRecurrenceRule,
  type TodoStatus
} from '../todoShared';
import { createPortal } from 'react-dom';
import AdminUserAvatar from '../components/AdminUserAvatar';
import { buildAdminUserIdentityView } from '../adminIdentity';
import {
  fetchAssignedTodoItems,
  fetchCreatedTodoItems,
  fetchPendingDeleteTodoItems,
  fetchTodoNavPendingCount,
  fetchTodoProfiles
} from '../todoData';

type TranslateFn = (zh: string, en: string) => string;
type TodoView = 'assigned' | 'completed' | 'created' | 'pending';

type Props = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  supabase: any;
  themeMode: 'light' | 'dark';
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  onPendingCountChange?: (count: number) => void;
};

type TodoProfile = {
  user_id: string;
  user_email: string;
  display_name: string;
  avatar_url?: string;
};

type FormState = {
  templateId: string | null;
  deliveryMode: TodoDeliveryMode;
  title: string;
  content: string;
  dueAt: string;
  recurrenceKind: TodoRecurrenceKind;
  recurrenceRule: TodoRecurrenceRule;
  assignees: TodoAssigneeInput[];
  links: TodoLinkInput[];
};

type TodoGroupParticipant = {
  item_id: string;
  assignee_user_id: string;
  assignee_email: string;
  assignee_display_name: string;
  assignee_avatar_url?: string;
  status: TodoStatus;
  due_at: string | null;
  completed_at: string | null;
  is_current_user: boolean;
};

type TodoItemGroup = {
  key: string;
  primary: TodoItemRecord;
  items: TodoItemRecord[];
  participants: TodoGroupParticipant[];
  hasCurrentUserParticipant: boolean;
  isGroupedIndividual: boolean;
};

const EMPTY_FORM: FormState = {
  templateId: null,
  deliveryMode: 'shared',
  title: '',
  content: '',
  dueAt: '',
  recurrenceKind: 'none',
  recurrenceRule: {},
  assignees: [],
  links: []
};

const WEEKDAY_OPTIONS = [
  { value: 1, zh: '周一', en: 'Mon' },
  { value: 2, zh: '周二', en: 'Tue' },
  { value: 3, zh: '周三', en: 'Wed' },
  { value: 4, zh: '周四', en: 'Thu' },
  { value: 5, zh: '周五', en: 'Fri' },
  { value: 6, zh: '周六', en: 'Sat' },
  { value: 7, zh: '周日', en: 'Sun' }
] as const;

const MONTHLY_WEEK_OPTIONS: Array<{ value: TodoMonthlyNthWeekday['week']; zh: string; en: string }> = [
  { value: 1, zh: '第 1 个', en: '1st' },
  { value: 2, zh: '第 2 个', en: '2nd' },
  { value: 3, zh: '第 3 个', en: '3rd' },
  { value: 4, zh: '第 4 个', en: '4th' },
  { value: -1, zh: '最后 1 个', en: 'Last' }
];

const formatDateTimeLocalInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-') + `T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const toIsoFromLocalInput = (value: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseMonthDays = (value: string) =>
  Array.from(new Set(String(value ?? '').split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 1 && item <= 31))).sort((a, b) => a - b);

const formatMonthDays = (values: number[] | undefined) => (values ?? []).join(', ');
const getProfileLabel = (profile: { display_name?: string; user_email?: string; user_id?: string }) => String(profile.display_name ?? '').trim() || String(profile.user_email ?? '').trim() || String(profile.user_id ?? '').trim();
const getProfileSubLabel = (profile: { user_email?: string; user_id?: string }) => String(profile.user_email ?? '').trim() || String(profile.user_id ?? '').trim();

const isTodoOverdue = (item: TodoItemRecord) => {
  if (item.status !== 'open' || !item.due_at) return false;
  const dueAt = new Date(item.due_at).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
};

const isParticipantOverdue = (participant: TodoGroupParticipant) => {
  if (participant.status !== 'open' || !participant.due_at) return false;
  const dueAt = new Date(participant.due_at).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
};

const getTodoGroupCardToneClass = (group: TodoItemGroup, isLight: boolean) => {
  const status = getTodoGroupStatus(group);
  if (status === 'done') return isLight ? 'border-emerald-300 bg-emerald-50/70' : 'border-emerald-500/35 bg-emerald-500/8';
  if (status === 'pending_delete') return isLight ? 'border-amber-300 bg-amber-50/70' : 'border-amber-500/35 bg-amber-500/8';
  if (status === 'deleted') return isLight ? 'border-slate-200 bg-slate-100/70' : 'border-white/10 bg-white/[0.03]';
  if (isTodoGroupOverdue(group)) return isLight ? 'border-rose-300 bg-rose-50/70' : 'border-rose-500/35 bg-rose-500/8';
  return isLight ? 'border-sky-300 bg-sky-50/70' : 'border-sky-500/35 bg-sky-500/8';
};

const getTodoGroupBadgeToneClass = (group: TodoItemGroup, isLight: boolean) => {
  const status = getTodoGroupStatus(group);
  if (status === 'done') return isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'pending_delete') return isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (status === 'deleted') return isLight ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-white/10 bg-white/5 text-white/50';
  if (isTodoGroupOverdue(group)) return isLight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  return isLight ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-sky-500/30 bg-sky-500/10 text-sky-200';
};

const getStatusText = (status: TodoStatus, t: TranslateFn) => {
  if (status === 'done') return t('已完成', 'Done');
  if (status === 'pending_delete') return t('待删确认', 'Pending delete');
  if (status === 'deleted') return t('已删除', 'Deleted');
  return t('进行中', 'Open');
};

const getTodoGroupStatusText = (group: TodoItemGroup, t: TranslateFn) => {
  if (isTodoGroupOverdue(group) && getTodoGroupStatus(group) === 'open') return t('已过期', 'Overdue');
  return getStatusText(getTodoGroupStatus(group), t);
};

const dispatchTodoUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TODO_UPDATED_EVENT));
};

const buildEditForm = (item: TodoItemRecord): FormState => ({
  templateId: item.template_id,
  deliveryMode: item.delivery_mode,
  title: item.title,
  content: item.content,
  dueAt: formatDateTimeLocalInput(item.due_at),
  recurrenceKind: item.recurrence_kind,
  recurrenceRule: item.recurrence_rule ?? {},
  assignees: item.assignees.map((assignee) => ({
    user_id: assignee.assignee_user_id,
    user_email: assignee.assignee_email,
    display_name: assignee.assignee_display_name,
    avatar_url: assignee.assignee_avatar_url
  })),
  links: item.links.map((link, index) => ({
    label: link.label,
    url: link.url,
    sort_order: Number.isFinite(link.sort_order) ? link.sort_order : index
  }))
});

const getTodoGroupKey = (item: TodoItemRecord) =>
  item.delivery_mode === 'individual' ? `${item.template_id}__${item.instance_date ?? 'single'}` : item.id;

const getTodoGroupStatus = (group: TodoItemGroup): TodoStatus => {
  if (group.items.every((item) => item.status === 'done')) return 'done';
  if (group.items.some((item) => item.status === 'pending_delete')) return 'pending_delete';
  if (group.items.every((item) => item.status === 'deleted')) return 'deleted';
  return 'open';
};

const isTodoGroupOverdue = (group: TodoItemGroup) => group.items.some((item) => isTodoOverdue(item));

const groupHasCurrentUserStatus = (group: TodoItemGroup, statuses: TodoStatus[]) =>
  group.participants.some((participant) => participant.is_current_user && statuses.includes(participant.status));

const buildTodoGroups = (items: TodoItemRecord[], userId: string) => {
  const groups = new Map<string, TodoItemGroup>();

  for (const item of items) {
    const key = getTodoGroupKey(item);
    const existing = groups.get(key);
    const participants = item.assignees.map((assignee) => ({
      item_id: item.id,
      assignee_user_id: assignee.assignee_user_id,
      assignee_email: assignee.assignee_email,
      assignee_display_name: assignee.assignee_display_name,
      assignee_avatar_url: assignee.assignee_avatar_url,
      status: item.status,
      due_at: item.due_at,
      completed_at: item.completed_at,
      is_current_user: assignee.assignee_user_id === userId
    }));

    if (!existing) {
      groups.set(key, {
        key,
        primary: item,
        items: [item],
        participants,
        hasCurrentUserParticipant: participants.some((participant) => participant.is_current_user),
        isGroupedIndividual: item.delivery_mode === 'individual'
      });
      continue;
    }

    existing.items.push(item);
    existing.participants.push(...participants);
    existing.hasCurrentUserParticipant = existing.hasCurrentUserParticipant || participants.some((participant) => participant.is_current_user);
    if (new Date(item.created_at).getTime() > new Date(existing.primary.created_at).getTime()) {
      existing.primary = item;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => left.created_at.localeCompare(right.created_at, 'en-US')),
      participants: [...group.participants].sort((left, right) =>
        (left.assignee_display_name || left.assignee_email || left.assignee_user_id).localeCompare(
          right.assignee_display_name || right.assignee_email || right.assignee_user_id,
          'en-US'
        )
      ),
      isGroupedIndividual: group.primary.delivery_mode === 'individual' && group.participants.length > 1
    }))
    .sort((left, right) => right.primary.created_at.localeCompare(left.primary.created_at, 'en-US'));
};
export default function TodoPage({
  t,
  isLocked,
  isReadOnly = false,
  supabase,
  themeMode,
  userId,
  userEmail = '',
  userDisplayName = '',
  onPendingCountChange
}: Props) {
  const isLight = themeMode === 'light';
  const writeLocked = isLocked || isReadOnly;
  const [view, setView] = useState<TodoView>('assigned');
  const [profiles, setProfiles] = useState<TodoProfile[]>([]);
  const [assignedItems, setAssignedItems] = useState<TodoItemRecord[]>([]);
  const [createdItems, setCreatedItems] = useState<TodoItemRecord[]>([]);
  const [pendingDeleteItems, setPendingDeleteItems] = useState<TodoItemRecord[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [participantsItem, setParticipantsItem] = useState<TodoItemRecord | null>(null);

  const buttonSecondaryClass = isLight
    ? 'admin-btn inline-flex h-10 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-400 disabled:opacity-60'
    : 'admin-btn admin-btn-secondary inline-flex h-10 items-center justify-center px-4 text-sm font-semibold disabled:opacity-60';
  const buttonPrimaryClass = isLight
    ? 'admin-btn inline-flex h-10 items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60'
    : 'admin-btn admin-btn-primary inline-flex h-10 items-center justify-center px-4 text-sm font-semibold text-slate-950 disabled:opacity-60';
  const panelClass = isLight ? 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm' : 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
  const modalPanelClass = isLight
    ? 'rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] md:p-7'
    : 'rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:p-7';
  const inputClass = isLight
    ? 'h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900'
    : 'h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white';
  const textareaClass = isLight
    ? 'min-h-[96px] rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900'
    : 'min-h-[96px] rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white';
  const labelClass = isLight ? 'text-xs uppercase tracking-[0.16em] text-slate-500' : 'text-xs uppercase tracking-[0.16em] text-white/60';

  const refreshAll = async () => {
    if (!supabase || !userId) return;
    setLoading(true);
    setError(null);
    const [profilesRes, assignedRes, createdRes, pendingRes, countRes] = await Promise.allSettled([
      fetchTodoProfiles(supabase),
      fetchAssignedTodoItems(supabase, userId),
      fetchCreatedTodoItems(supabase, userId),
      fetchPendingDeleteTodoItems(supabase, userId),
      fetchTodoNavPendingCount(supabase, userId)
    ]);

    try {
      if (profilesRes.status === 'fulfilled') {
        setProfiles(profilesRes.value);
      }
      if (assignedRes.status === 'fulfilled') {
        setAssignedItems(assignedRes.value);
      } else {
        setAssignedItems([]);
      }
      if (createdRes.status === 'fulfilled') {
        setCreatedItems(createdRes.value);
      } else {
        setCreatedItems([]);
      }
      if (pendingRes.status === 'fulfilled') {
        setPendingDeleteItems(pendingRes.value);
      } else {
        setPendingDeleteItems([]);
      }
      onPendingCountChange?.(countRes.status === 'fulfilled' ? countRes.value : 0);

      const messages = [profilesRes, assignedRes, createdRes, pendingRes, countRes]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => String((result.reason as any)?.message ?? result.reason ?? 'Request failed.'));

      if (messages.length > 0) {
        setError(messages[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, [supabase, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => void refreshAll();
    window.addEventListener(TODO_UPDATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(TODO_UPDATED_EVENT, handler as EventListener);
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId) return;
    setForm((prev) =>
      prev.assignees.length > 0
        ? prev
        : {
            ...prev,
            assignees: normalizeTodoAssignees([
              {
                user_id: userId,
                user_email: String(userEmail ?? '').trim(),
                display_name: String(userDisplayName ?? '').trim() || String(userEmail ?? '').trim() || userId,
                avatar_url: ''
              }
            ])
          }
    );
  }, [userDisplayName, userEmail, userId]);

  useEffect(() => {
    if (!formOpen || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        setFormOpen(false);
        setAssigneePickerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formOpen, saving]);

  const visibleAssignedItems = useMemo(() => assignedItems.filter((item) => item.status !== 'deleted'), [assignedItems]);
  const visibleCreatedItems = useMemo(() => createdItems.filter((item) => item.status !== 'deleted'), [createdItems]);
  const allAssignedGroups = useMemo(
    () =>
      buildTodoGroups(visibleAssignedItems, userId).filter(
        (group) =>
          group.primary.delivery_mode === 'shared'
            ? group.primary.assignees.some((assignee) => assignee.assignee_user_id === userId)
            : group.hasCurrentUserParticipant
      ),
    [userId, visibleAssignedItems]
  );
  const assignedGroups = useMemo(() => allAssignedGroups.filter((group) => groupHasCurrentUserStatus(group, ['open'])), [allAssignedGroups]);
  const completedGroups = useMemo(() => allAssignedGroups.filter((group) => groupHasCurrentUserStatus(group, ['done'])), [allAssignedGroups]);
  const createdGroups = useMemo(() => buildTodoGroups(visibleCreatedItems, userId), [userId, visibleCreatedItems]);
  const pendingGroups = useMemo(() => buildTodoGroups(pendingDeleteItems, userId), [pendingDeleteItems, userId]);

  const assigneeOptions = useMemo(() => {
    const next = new Map<string, TodoProfile>();
    for (const profile of profiles) {
      if (profile.user_id) next.set(profile.user_id, profile);
    }
    if (userId) {
      next.set(userId, {
        user_id: userId,
        user_email: String(userEmail ?? '').trim(),
        display_name: String(userDisplayName ?? '').trim() || String(userEmail ?? '').trim() || userId,
        avatar_url: ''
      });
    }
    for (const assignee of form.assignees) {
      if (!assignee.user_id) continue;
      next.set(assignee.user_id, {
        user_id: assignee.user_id,
        user_email: String(assignee.user_email ?? '').trim(),
        display_name: String(assignee.display_name ?? '').trim() || String(assignee.user_email ?? '').trim() || assignee.user_id,
        avatar_url: String((assignee as any).avatar_url ?? '').trim()
      });
    }
    return Array.from(next.values()).sort((left, right) => getProfileLabel(left).localeCompare(getProfileLabel(right), 'en-US'));
  }, [form.assignees, profiles, userDisplayName, userEmail, userId]);
  const profileByUserId = useMemo(() => new Map(assigneeOptions.map((item) => [item.user_id, item] as const)), [assigneeOptions]);
  const resolveTodoIdentity = (profile: {
    user_id?: string;
    user_email?: string;
    display_name?: string;
    avatar_url?: string;
  }) => {
    const cached = profile.user_id ? profileByUserId.get(profile.user_id) : undefined;
    return buildAdminUserIdentityView({
      userId: profile.user_id || cached?.user_id,
      userEmail: profile.user_email || cached?.user_email,
      displayName: profile.display_name || cached?.display_name,
      avatarUrl: profile.avatar_url || cached?.avatar_url
    });
  };

  const filteredAssigneeOptions = useMemo(() => {
    const selectedIds = new Set(form.assignees.map((item) => item.user_id));
    const needle = assigneeQuery.trim().toLowerCase();
    return assigneeOptions.filter((profile) => {
      if (selectedIds.has(profile.user_id)) return false;
      if (!needle) return true;
      return [profile.display_name, profile.user_email, profile.user_id].join(' ').toLowerCase().includes(needle);
    });
  }, [assigneeOptions, assigneeQuery, form.assignees]);

  const buildDefaultAssignees = () =>
    normalizeTodoAssignees(
      userId
        ? [{ user_id: userId, user_email: String(userEmail ?? '').trim(), display_name: String(userDisplayName ?? '').trim() || String(userEmail ?? '').trim() || userId, avatar_url: '' }]
        : []
    );

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setAssigneePickerOpen(false);
    setAssigneeQuery('');
  };

  const resetForm = () => {
    setForm({
      ...EMPTY_FORM,
      assignees: buildDefaultAssignees()
    });
    setAssigneeQuery('');
    setAssigneePickerOpen(false);
    setFormOpen(true);
  };

  const openEditForm = (item: TodoItemRecord) => {
    setForm(buildEditForm(item));
    setAssigneeQuery('');
    setAssigneePickerOpen(false);
    setFormOpen(true);
  };

  const clearFormFields = () => {
    setForm({
      ...EMPTY_FORM,
      assignees: buildDefaultAssignees()
    });
    setAssigneeQuery('');
    setAssigneePickerOpen(false);
  };
  const toggleAssignee = (profile: TodoProfile) => {
    setForm((prev) => {
      const exists = prev.assignees.some((item) => item.user_id === profile.user_id);
      const nextAssignees = exists ? prev.assignees.filter((item) => item.user_id !== profile.user_id) : [...prev.assignees, profile];
      return { ...prev, assignees: normalizeTodoAssignees(nextAssignees) };
    });
  };

  const removeAssignee = (profileId: string) => {
    setForm((prev) => ({ ...prev, assignees: normalizeTodoAssignees(prev.assignees.filter((item) => item.user_id !== profileId)) }));
  };

  const addLink = () => setForm((prev) => ({ ...prev, links: [...prev.links, { label: '', url: '', sort_order: prev.links.length }] }));
  const updateLink = (index: number, patch: Partial<TodoLinkInput>) => setForm((prev) => ({ ...prev, links: prev.links.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) }));
  const removeLink = (index: number) => setForm((prev) => ({ ...prev, links: prev.links.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, sort_order: itemIndex })) }));
  const moveLink = (index: number, direction: -1 | 1) => {
    setForm((prev) => {
      const next = [...prev.links];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return { ...prev, links: next.map((item, itemIndex) => ({ ...item, sort_order: itemIndex })) };
    });
  };

  const addMonthlyNthWeekday = () => setForm((prev) => ({ ...prev, recurrenceRule: { ...prev.recurrenceRule, nth_weekdays: [...(prev.recurrenceRule.nth_weekdays ?? []), { week: 1, weekday: 1 }] } }));
  const updateMonthlyNthWeekday = (index: number, patch: Partial<TodoMonthlyNthWeekday>) => setForm((prev) => ({ ...prev, recurrenceRule: { ...prev.recurrenceRule, nth_weekdays: (prev.recurrenceRule.nth_weekdays ?? []).map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) } }));
  const removeMonthlyNthWeekday = (index: number) => setForm((prev) => ({ ...prev, recurrenceRule: { ...prev.recurrenceRule, nth_weekdays: (prev.recurrenceRule.nth_weekdays ?? []).filter((_, itemIndex) => itemIndex !== index) } }));

  const validateForm = () => {
    if (!form.title.trim()) throw new Error(t('任务标题不能为空。', 'Task title is required.'));
    if (!form.assignees.length) throw new Error(t('至少选择一个被分配人。', 'Select at least one assignee.'));
    const normalizedLinks = normalizeTodoLinks(form.links);
    if (normalizedLinks.some((item) => !isValidTodoUrl(item.url))) {
      throw new Error(t('链接必须以 http:// 或 https:// 开头。', 'Links must start with http:// or https://.'));
    }
    if (form.recurrenceKind !== 'none' && !form.dueAt) {
      throw new Error(t('重复任务必须设置截止时间。', 'Recurring tasks require a due time.'));
    }
    return normalizedLinks;
  };

  const saveTask = async () => {
    if (!supabase || !userId || saving || isLocked) return;
    setSaving(true);
    setError(null);
    try {
      const normalizedLinks = validateForm();
      const dueAtIso = toIsoFromLocalInput(form.dueAt);
      const instanceDate = getTodoInstanceDateFromDueAt(dueAtIso);
      if (!form.templateId) {
        const { error: rpcError } = await supabase.rpc('create_todo_task', {
          p_delivery_mode: form.deliveryMode,
          p_title: form.title.trim(),
          p_content: form.content.trim(),
          p_due_at: dueAtIso,
          p_instance_date: instanceDate,
          p_recurrence_kind: form.recurrenceKind,
          p_recurrence_rule: form.recurrenceRule,
          p_assignees: normalizeTodoAssignees(form.assignees),
          p_links: normalizedLinks
        });
        if (rpcError) throw new Error(String(rpcError.message ?? 'Failed to create task.'));
      } else {
        const { error: rpcError } = await supabase.rpc('update_todo_task', {
          p_template_id: form.templateId,
          p_title: form.title.trim(),
          p_content: form.content.trim(),
          p_due_at: dueAtIso,
          p_instance_date: instanceDate,
          p_recurrence_kind: form.recurrenceKind,
          p_recurrence_rule: form.recurrenceRule,
          p_assignees: normalizeTodoAssignees(form.assignees),
          p_links: normalizedLinks,
          p_is_active: true
        });
        if (rpcError) throw new Error(String(rpcError.message ?? 'Failed to update task.'));
      }
      dispatchTodoUpdated();
      await refreshAll();
      clearFormFields();
      setFormOpen(false);
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to save task.'));
    } finally {
      setSaving(false);
    }
  };

  const applyItemAction = async (itemId: string, action: 'mark_done' | 'mark_open' | 'request_delete' | 'approve_delete' | 'reject_delete') => {
    if (!supabase || !itemId || saving || isLocked) return;
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('apply_todo_item_action', { p_item_id: itemId, p_action: action });
      if (rpcError) throw new Error(String(rpcError.message ?? 'Failed to update task.'));
      dispatchTodoUpdated();
      await refreshAll();
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to update task.'));
    } finally {
      setSaving(false);
    }
  };

  const applyItemActionMany = async (itemIds: string[], action: 'request_delete' | 'approve_delete' | 'reject_delete') => {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    if (!supabase || !ids.length || saving || isLocked) return;
    setSaving(true);
    setError(null);
    try {
      for (const itemId of ids) {
        const { error: rpcError } = await supabase.rpc('apply_todo_item_action', { p_item_id: itemId, p_action: action });
        if (rpcError) throw new Error(String(rpcError.message ?? 'Failed to update task.'));
      }
      dispatchTodoUpdated();
      await refreshAll();
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to update task.'));
    } finally {
      setSaving(false);
    }
  };

  const renderActionLinks = (item: TodoItemRecord) =>
    item.links.map((link) => (
      <a key={link.id} href={link.url} target="_blank" rel="noreferrer" title={link.label || link.url} className={buttonSecondaryClass}>
        {link.label}
      </a>
    ));

  const closeParticipants = () => {
    setParticipantsItem(null);
  };

  const renderGroupParticipants = (group: TodoItemGroup, mode: 'assigned' | 'completed' | 'created' | 'pending') =>
    !group.isGroupedIndividual ? null : (
      <div className="space-y-2">
        {group.participants.map((participant) => {
          const canToggle =
            (mode === 'assigned' || mode === 'completed' || mode === 'created') &&
            participant.is_current_user &&
            (participant.status === 'open' || participant.status === 'done');
          const overdue = isParticipantOverdue(participant);
          const rowTone =
            participant.status === 'done'
              ? isLight
                ? 'border-emerald-200 bg-emerald-50/60'
                : 'border-emerald-500/20 bg-emerald-500/8'
              : overdue
                ? isLight
                  ? 'border-rose-200 bg-rose-50/60'
                  : 'border-rose-500/20 bg-rose-500/8'
              : participant.is_current_user
                ? isLight
                  ? 'border-sky-200 bg-sky-50/60'
                  : 'border-sky-500/20 bg-sky-500/8'
                : isLight
                  ? 'border-slate-200 bg-white'
                  : 'border-white/10 bg-white/[0.03]';
          return (
            <div key={participant.item_id} className={['flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5', rowTone].join(' ')}>
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  disabled={!canToggle}
                  onClick={() => void applyItemAction(participant.item_id, participant.status === 'done' ? 'mark_open' : 'mark_done')}
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
                    participant.status === 'done'
                      ? isLight
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-neon bg-neon text-slate-950'
                      : isLight
                        ? 'border-slate-300 bg-white text-transparent'
                        : 'border-white/20 bg-transparent text-transparent',
                    canToggle ? (isLight ? 'hover:border-sky-500' : 'hover:border-neon') : 'cursor-default opacity-70'
                  ].join(' ')}
                  aria-label={participant.status === 'done' ? t('恢复未完成', 'Reopen') : t('完成', 'Done')}
                >
                  <span className="text-xs font-bold leading-none">{participant.status === 'done' ? '✓' : ''}</span>
                </button>
                <AdminUserAvatar
                  name={resolveTodoIdentity({
                    user_id: participant.assignee_user_id,
                    user_email: participant.assignee_email,
                    display_name: participant.assignee_display_name,
                    avatar_url: participant.assignee_avatar_url
                  }).displayName}
                  avatarUrl={resolveTodoIdentity({
                    user_id: participant.assignee_user_id,
                    user_email: participant.assignee_email,
                    display_name: participant.assignee_display_name,
                    avatar_url: participant.assignee_avatar_url
                  }).avatarUrl}
                  fallbackInitial={resolveTodoIdentity({
                    user_id: participant.assignee_user_id,
                    user_email: participant.assignee_email,
                    display_name: participant.assignee_display_name,
                    avatar_url: participant.assignee_avatar_url
                  }).fallbackInitial}
                  size={28}
                  className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-800 text-slate-100'}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {participant.assignee_display_name || participant.assignee_email || participant.assignee_user_id}
                    {participant.is_current_user ? ` · ${t('我', 'Me')}` : ''}
                  </div>
                  <div className={['truncate text-xs', isLight ? 'text-slate-500' : 'text-white/50'].join(' ')}>
                    {participant.assignee_email || participant.assignee_user_id}
                  </div>
                </div>
              </div>
              <span
                className={[
                  'inline-flex min-w-[72px] items-center justify-center rounded-full border px-2.5 py-1 text-center text-[11px] font-semibold',
                  participant.status === 'done'
                    ? isLight
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                    : overdue
                      ? isLight
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                      : isLight
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-sky-500/25 bg-sky-500/10 text-sky-200'
                ].join(' ')}
              >
                {participant.status === 'done' ? t('已完成', 'Done') : overdue ? t('已过期', 'Overdue') : t('进行中', 'Open')}
              </span>
            </div>
          );
        })}
      </div>
    );

  const renderGroupCard = (group: TodoItemGroup, mode: 'assigned' | 'completed' | 'created' | 'pending') => {
    const item = group.primary;
    const currentUserItemIds = group.participants.filter((participant) => participant.is_current_user).map((participant) => participant.item_id);
    const groupItemIds = group.items.map((entry) => entry.id);
    const pendingItemIds = group.items.filter((entry) => entry.status === 'pending_delete').map((entry) => entry.id);

    return (
      <article key={group.key} className={['space-y-3 rounded-2xl border p-4', getTodoGroupCardToneClass(group, isLight)].join(' ')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
          {!group.isGroupedIndividual ? (
            <button
              type="button"
              disabled={(mode !== 'assigned' && mode !== 'completed') || saving || writeLocked || (item.status !== 'open' && item.status !== 'done')}
              onClick={() => {
                if (mode !== 'assigned' && mode !== 'completed') return;
                if (item.status === 'done') {
                  void applyItemAction(item.id, 'mark_open');
                  return;
                }
                if (item.status === 'open') {
                  void applyItemAction(item.id, 'mark_done');
                }
              }}
              aria-label={item.status === 'done' ? t('恢复未完成', 'Reopen') : t('完成', 'Done')}
              className={[
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition',
                item.status === 'done'
                  ? isLight
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-neon bg-neon text-slate-950'
                  : isLight
                    ? 'border-slate-300 bg-white text-transparent'
                    : 'border-white/20 bg-transparent text-transparent',
                (mode === 'assigned' || mode === 'completed') && !saving && !isLocked && (item.status === 'open' || item.status === 'done')
                  ? isLight
                    ? 'hover:border-sky-500'
                    : 'hover:border-neon'
                  : 'cursor-default opacity-70'
              ].join(' ')}
            >
              <span className="text-sm font-bold leading-none">{item.status === 'done' ? '✓' : ''}</span>
            </button>
          ) : null}
          <AdminUserAvatar
            name={resolveTodoIdentity({
              user_id: item.creator_user_id,
              user_email: item.creator_email,
              display_name: item.creator_display_name
            }).displayName}
            avatarUrl={resolveTodoIdentity({
              user_id: item.creator_user_id,
              user_email: item.creator_email,
              display_name: item.creator_display_name
            }).avatarUrl}
            fallbackInitial={resolveTodoIdentity({
              user_id: item.creator_user_id,
              user_email: item.creator_email,
              display_name: item.creator_display_name
            }).fallbackInitial}
            size={32}
            className={isLight ? 'mt-0.5 border-slate-200 bg-slate-200 text-slate-700' : 'mt-0.5 border-white/10 bg-slate-800 text-slate-100'}
          />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{item.title}</h3>
            <div className={['mt-1 text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>
              {item.creator_display_name || item.creator_email || '-'}
              {item.due_at ? ` · ${new Date(item.due_at).toLocaleString()}` : ''}
            </div>
          </div>
        </div>
        <span className={['rounded-full border px-3 py-1 text-xs font-semibold', getTodoGroupBadgeToneClass(group, isLight)].join(' ')}>{getTodoGroupStatusText(group, t)}</span>
      </div>
      {item.content ? <div className={['whitespace-pre-wrap text-sm', isLight ? 'text-slate-700' : 'text-white/80'].join(' ')}>{item.content}</div> : null}
      <div className={['text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>
        {group.isGroupedIndividual ? (
          t(`个人任务 · ${group.participants.length} 人`, `Individual · ${group.participants.length} assignees`)
        ) : item.delivery_mode === 'shared' ? (
          <span className="inline-flex items-center gap-1.5">
            <span>{t('共享任务', 'Shared')}</span>
            <span>·</span>
            <button
              type="button"
              className={[isLight ? 'text-sky-700 hover:text-sky-800' : 'text-sky-300 hover:text-sky-200', 'font-semibold underline underline-offset-2'].join(' ')}
              onClick={() => setParticipantsItem(item)}
            >
              {t(`${item.assignees.length} 人`, `${item.assignees.length} assignees`)}
            </button>
          </span>
        ) : item.assignees[0]?.assignee_display_name || item.assignees[0]?.assignee_email || t('个人任务', 'Individual')}
      </div>
      {renderGroupParticipants(group, mode)}
      <div className="flex flex-wrap items-center gap-2">
        {(mode === 'assigned' || mode === 'completed' || mode === 'created') && getTodoGroupStatus(group) !== 'deleted' && getTodoGroupStatus(group) !== 'pending_delete' ? (
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={saving || writeLocked}
            onClick={() => {
              if (mode === 'assigned' || mode === 'completed') {
                void applyItemActionMany(currentUserItemIds, 'request_delete');
                return;
              }
              void applyItemActionMany(groupItemIds, 'request_delete');
            }}
          >
            {t('删除', 'Delete')}
          </button>
        ) : null}
        {renderActionLinks(item)}
        {item.creator_user_id === userId ? <button type="button" className={buttonSecondaryClass} disabled={saving || writeLocked} onClick={() => openEditForm(item)}>{t('编辑', 'Edit')}</button> : null}
        {mode === 'pending' ? (
          <>
            <button type="button" className={buttonPrimaryClass} disabled={saving || writeLocked} onClick={() => void applyItemActionMany(pendingItemIds, 'approve_delete')}>{t('确认删除', 'Approve delete')}</button>
            <button type="button" className={buttonSecondaryClass} disabled={saving || writeLocked} onClick={() => void applyItemActionMany(pendingItemIds, 'reject_delete')}>{t('驳回', 'Reject')}</button>
          </>
        ) : null}
      </div>
    </article>
    );
  };

  const tabs: Array<[TodoView, string]> = [
    ['assigned', t('我的任务', 'Assigned')],
    ['completed', t('已完成', 'Completed')],
    ['created', t('我发布的', 'Created')],
    ['pending', t('待删确认', 'Pending delete')]
  ];
  const modalRoot = typeof document === 'undefined' ? null : document.body;

  return (
    <section className="px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-2xl tracking-[0.08em]">{t('待办', 'ToDo')}</h2></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondaryClass} disabled={loading || isLocked} onClick={() => void refreshAll()}>{t('刷新', 'Refresh')}</button>
          <button type="button" className={buttonPrimaryClass} disabled={writeLocked} onClick={resetForm}>{t('新建任务', 'New Task')}</button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map(([nextView, label]) => (
          <button key={nextView} type="button" className={[buttonSecondaryClass, view === nextView ? (isLight ? 'border-sky-500 text-sky-700' : 'border-neon text-neon') : ''].join(' ')} onClick={() => setView(nextView)}>{label}</button>
        ))}
      </div>

      {error ? <div className={['mt-4 rounded-2xl border px-4 py-3 text-sm', isLight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'].join(' ')}>{error}</div> : null}

      <div className="mt-6 space-y-4">
        {view === 'assigned' && assignedGroups.map((group) => renderGroupCard(group, 'assigned'))}
        {view === 'completed' && completedGroups.map((group) => renderGroupCard(group, 'completed'))}
        {view === 'created' && createdGroups.map((group) => renderGroupCard(group, 'created'))}
        {view === 'pending' && pendingGroups.map((group) => renderGroupCard(group, 'pending'))}
        {((view === 'assigned' && !assignedGroups.length) || (view === 'completed' && !completedGroups.length) || (view === 'created' && !createdGroups.length) || (view === 'pending' && !pendingGroups.length)) ? <div className={panelClass}>{t('暂无任务。', 'No tasks yet.')}</div> : null}
      </div>

      {formOpen && modalRoot
        ? createPortal(
            <div
              className={['fixed inset-0 z-[110] flex items-center justify-center p-4', isLight ? 'bg-slate-900/45' : 'bg-black/72'].join(' ')}
              role="dialog"
              aria-modal="true"
            >
              <aside
                className={[modalPanelClass, 'max-h-[calc(100vh-32px)] w-full max-w-3xl overflow-y-auto'].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">{form.templateId ? t('编辑任务', 'Edit Task') : t('新建任务', 'New Task')}</h3>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={buttonPrimaryClass} disabled={saving || writeLocked} onClick={() => void saveTask()}>{form.templateId ? t('保存修改', 'Save') : t('创建任务', 'Create')}</button>
                    <button type="button" className={buttonSecondaryClass} disabled={saving || writeLocked} onClick={clearFormFields}>{t('重置', 'Reset')}</button>
                    <button type="button" className={buttonSecondaryClass} disabled={saving} onClick={closeForm}>{t('关闭', 'Close')}</button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
            <div>
              <div className={labelClass}>{t('发布模式', 'Mode')}</div>
              <select className={['mt-1 w-full', inputClass].join(' ')} value={form.deliveryMode} disabled={Boolean(form.templateId)} onChange={(event) => setForm((prev) => ({ ...prev, deliveryMode: event.target.value as TodoDeliveryMode }))}>
                <option value="shared">{t('共同任务', 'Shared task')}</option>
                <option value="individual">{t('个人任务', 'Individual task')}</option>
              </select>
            </div>

            <div>
              <div className={labelClass}>{t('被分配人', 'Assignees')}</div>
              <div className="mt-2 space-y-2" onFocusCapture={() => { setAssigneePickerOpen(true); }} onBlurCapture={(event) => { if (event.currentTarget.contains(event.relatedTarget as Node | null)) return; setAssigneePickerOpen(false); }}>
                <div className={['rounded-2xl border p-3 transition', isLight ? 'border-slate-300 bg-white focus-within:border-sky-500' : 'border-white/10 bg-white/[0.04] focus-within:border-neon/70'].join(' ')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {form.assignees.map((assignee) => (
                      <span key={assignee.user_id} className={['inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm', isLight ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-white/15 bg-white/[0.05] text-white/85'].join(' ')}>
                        <AdminUserAvatar
                          name={resolveTodoIdentity(assignee).displayName}
                          avatarUrl={resolveTodoIdentity(assignee).avatarUrl}
                          fallbackInitial={resolveTodoIdentity(assignee).fallbackInitial}
                          size={24}
                          className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-800 text-slate-100'}
                        />
                        <span>{getProfileLabel(assignee)}</span>
                        <button type="button" className={isLight ? 'text-slate-500 hover:text-slate-800' : 'text-white/50 hover:text-white'} onClick={() => removeAssignee(assignee.user_id)}>×</button>
                      </span>
                    ))}
                    <input className={['min-w-[180px] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none', isLight ? 'text-slate-900 placeholder:text-slate-400' : 'text-white placeholder:text-white/35'].join(' ')} value={assigneeQuery} onChange={(event) => { setAssigneeQuery(event.target.value); setAssigneePickerOpen(true); }} onFocus={() => setAssigneePickerOpen(true)} placeholder={t('添加人员、姓名或邮箱', 'Add people, name, or email')} />
                  </div>
                </div>
                {assigneePickerOpen ? (
                  <div className={['max-h-56 overflow-auto rounded-2xl border p-2', isLight ? 'border-slate-200 bg-white shadow-sm' : 'border-white/10 bg-slate-950/95'].join(' ')}>
                    {!assigneeOptions.length ? <div className={['px-3 py-2 text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>{t('暂无可选账号。', 'No accounts available.')}</div> : null}
                    {assigneeOptions.length > 0 && !filteredAssigneeOptions.length ? <div className={['px-3 py-2 text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>{t('没有匹配的账号。', 'No matching accounts.')}</div> : null}
                    {filteredAssigneeOptions.map((profile) => (
                      <button key={profile.user_id} type="button" className={['flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition', isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.05]'].join(' ')} onClick={() => { toggleAssignee(profile); setAssigneeQuery(''); setAssigneePickerOpen(true); }}>
                        <AdminUserAvatar
                          name={resolveTodoIdentity(profile).displayName}
                          avatarUrl={resolveTodoIdentity(profile).avatarUrl}
                          fallbackInitial={resolveTodoIdentity(profile).fallbackInitial}
                          size={32}
                          className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-800 text-slate-100'}
                        />
                        <span className="min-w-0"><span className="block truncate font-medium">{getProfileLabel(profile)}</span><span className={['block truncate text-xs', isLight ? 'text-slate-500' : 'text-white/50'].join(' ')}>{getProfileSubLabel(profile)}</span></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className={labelClass}>{t('标题', 'Title')}</div>
              <input className={['mt-1 w-full', inputClass].join(' ')} value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
            </div>

            <div>
              <div className={labelClass}>{t('内容', 'Content')}</div>
              <textarea className={['mt-1 w-full', textareaClass].join(' ')} value={form.content} onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))} />
            </div>

            <div>
              <div className={labelClass}>{t('截止时间', 'Due')}</div>
              <input type="datetime-local" className={['mt-1 w-full', inputClass].join(' ')} value={form.dueAt} onChange={(event) => setForm((prev) => ({ ...prev, dueAt: event.target.value }))} />
            </div>
            <div>
              <div className={labelClass}>{t('重复', 'Repeat')}</div>
              <select className={['mt-1 w-full', inputClass].join(' ')} value={form.recurrenceKind} onChange={(event) => setForm((prev) => ({ ...prev, recurrenceKind: event.target.value as TodoRecurrenceKind, recurrenceRule: {} }))}>
                <option value="none">{t('无', 'None')}</option>
                <option value="daily">{t('每日', 'Daily')}</option>
                <option value="weekly">{t('每周', 'Weekly')}</option>
                <option value="monthly">{t('每月', 'Monthly')}</option>
              </select>
            </div>

            {form.recurrenceKind === 'daily' ? (
              <div>
                <div className={labelClass}>{t('每 N 天', 'Every N days')}</div>
                <input type="number" min={1} className={['mt-1 w-full', inputClass].join(' ')} value={String(form.recurrenceRule.interval_days ?? 1)} onChange={(event) => setForm((prev) => ({ ...prev, recurrenceRule: { interval_days: Math.max(1, Number(event.target.value || 1)) } }))} />
              </div>
            ) : null}

            {form.recurrenceKind === 'weekly' ? (
              <div>
                <div className={labelClass}>{t('周几', 'Weekdays')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((option) => {
                    const selected = (form.recurrenceRule.weekdays ?? []).includes(option.value);
                    return (
                      <button key={option.value} type="button" className={[buttonSecondaryClass, selected ? (isLight ? 'border-sky-500 text-sky-700' : 'border-neon text-neon') : ''].join(' ')} onClick={() => setForm((prev) => { const current = new Set(prev.recurrenceRule.weekdays ?? []); if (current.has(option.value)) current.delete(option.value); else current.add(option.value); return { ...prev, recurrenceRule: { weekdays: Array.from(current).sort((a, b) => a - b) } }; })}>
                        {t(option.zh, option.en)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {form.recurrenceKind === 'monthly' ? (
              <div className="space-y-4">
                <div>
                  <div className={labelClass}>{t('每月几号', 'Month days')}</div>
                  <input className={['mt-1 w-full', inputClass].join(' ')} value={formatMonthDays(form.recurrenceRule.month_days)} onChange={(event) => setForm((prev) => ({ ...prev, recurrenceRule: { ...prev.recurrenceRule, month_days: parseMonthDays(event.target.value) } }))} placeholder={t('例如 5,15,28', 'e.g. 5,15,28')} />
                </div>
                <div>
                  <div className={labelClass}>{t('第几个周几', 'Nth weekday')}</div>
                  <div className="mt-2 space-y-2">
                    {(form.recurrenceRule.nth_weekdays ?? []).map((item, index) => (
                      <div key={`${item.week}-${item.weekday}-${index}`} className="flex flex-wrap gap-2">
                        <select className={inputClass} value={String(item.week)} onChange={(event) => updateMonthlyNthWeekday(index, { week: Number(event.target.value) as TodoMonthlyNthWeekday['week'] })}>
                          {MONTHLY_WEEK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.zh, option.en)}</option>)}
                        </select>
                        <select className={inputClass} value={String(item.weekday)} onChange={(event) => updateMonthlyNthWeekday(index, { weekday: Number(event.target.value) as TodoMonthlyNthWeekday['weekday'] })}>
                          {WEEKDAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.zh, option.en)}</option>)}
                        </select>
                        <button type="button" className={buttonSecondaryClass} onClick={() => removeMonthlyNthWeekday(index)}>{t('删除', 'Remove')}</button>
                      </div>
                    ))}
                    <button type="button" className={buttonSecondaryClass} onClick={addMonthlyNthWeekday}>{t('新增规则', 'Add rule')}</button>
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <div className={labelClass}>{t('链接', 'Links')}</div>
              <div className="mt-2 space-y-3">
                {form.links.map((link, index) => (
                  <div key={`link-${index}`} className={['rounded-2xl border p-3', isLight ? 'border-slate-200' : 'border-white/10'].join(' ')}>
                    <div className="grid gap-3 md:grid-cols-[1fr_1.6fr_auto]">
                      <input className={inputClass} placeholder={t('按钮名', 'Button label')} value={link.label} onChange={(event) => updateLink(index, { label: event.target.value })} />
                      <input className={inputClass} placeholder="https://" value={link.url} onChange={(event) => updateLink(index, { url: event.target.value })} />
                      <div className="flex gap-2">
                        <button type="button" className={buttonSecondaryClass} disabled={index === 0} onClick={() => moveLink(index, -1)}>{t('上移', 'Up')}</button>
                        <button type="button" className={buttonSecondaryClass} disabled={index === form.links.length - 1} onClick={() => moveLink(index, 1)}>{t('下移', 'Down')}</button>
                        <button type="button" className={buttonSecondaryClass} onClick={() => removeLink(index)}>{t('删除', 'Remove')}</button>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" className={buttonSecondaryClass} onClick={addLink}>{t('新增链接', 'Add link')}</button>
              </div>
            </div>
                </div>
              </aside>
            </div>,
            modalRoot
          )
        : null}

      {participantsItem && modalRoot
        ? createPortal(
            <div
              className={['fixed inset-0 z-[111] flex items-center justify-center p-4', isLight ? 'bg-slate-900/45' : 'bg-black/72'].join(' ')}
              role="dialog"
              aria-modal="true"
            >
              <aside className={[modalPanelClass, 'w-full max-w-lg'].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{t('参与人', 'Participants')}</h3>
                    <div className={['mt-1 text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>
                      {participantsItem.title}
                    </div>
                  </div>
                  <button type="button" className={buttonSecondaryClass} onClick={closeParticipants}>{t('关闭', 'Close')}</button>
                </div>

                <div className="mt-4 space-y-2">
                  {participantsItem.assignees.map((assignee) => (
                    <div
                      key={`${participantsItem.id}-${assignee.id}`}
                      className={[
                        'flex items-center gap-3 rounded-2xl border px-3 py-3',
                        isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.04]'
                      ].join(' ')}
                    >
                      <AdminUserAvatar
                        name={resolveTodoIdentity({
                          user_id: assignee.assignee_user_id,
                          user_email: assignee.assignee_email,
                          display_name: assignee.assignee_display_name,
                          avatar_url: assignee.assignee_avatar_url
                        }).displayName}
                        avatarUrl={resolveTodoIdentity({
                          user_id: assignee.assignee_user_id,
                          user_email: assignee.assignee_email,
                          display_name: assignee.assignee_display_name,
                          avatar_url: assignee.assignee_avatar_url
                        }).avatarUrl}
                        fallbackInitial={resolveTodoIdentity({
                          user_id: assignee.assignee_user_id,
                          user_email: assignee.assignee_email,
                          display_name: assignee.assignee_display_name,
                          avatar_url: assignee.assignee_avatar_url
                        }).fallbackInitial}
                        size={36}
                        className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-800 text-slate-100'}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {assignee.assignee_display_name || assignee.assignee_email || assignee.assignee_user_id}
                        </div>
                        <div className={['truncate text-xs', isLight ? 'text-slate-500' : 'text-white/50'].join(' ')}>
                          {assignee.assignee_email || assignee.assignee_user_id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>,
            modalRoot
          )
        : null}
    </section>
  );
}

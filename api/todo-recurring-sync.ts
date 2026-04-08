import { createServiceSupabase, ensureCron, getDefaultTargetDate } from './_forecastShared';
import {
  buildTodoDueAtForInstance,
  getDateOnlyInTimeZone,
  listTodoOccurrenceDates,
  type TodoAssigneeInput,
  type TodoLinkInput,
  type TodoRecurrenceKind,
  type TodoRecurrenceRule
} from '../src/admin/todoShared';

type TodoTemplateRow = {
  id: string;
  creator_user_id: string;
  creator_email: string | null;
  creator_display_name: string | null;
  delivery_mode: 'shared' | 'individual';
  title: string;
  content: string | null;
  due_at: string | null;
  anchor_instance_date: string | null;
  recurrence_kind: TodoRecurrenceKind;
  recurrence_rule: TodoRecurrenceRule | null;
  assignees: TodoAssigneeInput[] | null;
  links: TodoLinkInput[] | null;
};

const normalizeAssignees = (value: TodoTemplateRow['assignees']) =>
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      user_id: String(item?.user_id ?? '').trim(),
      user_email: String(item?.user_email ?? '').trim(),
      display_name: String(item?.display_name ?? '').trim()
    }))
    .filter((item) => item.user_id);

const normalizeLinks = (value: TodoTemplateRow['links']) =>
  (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      label: String(item?.label ?? '').trim(),
      url: String(item?.url ?? '').trim(),
      sort_order: Number.isFinite(item?.sort_order) ? Number(item.sort_order) : index
    }))
    .filter((item) => item.label && item.url)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'en-US'))
    .map((item, index) => ({ ...item, sort_order: index }));

const isDuplicateError = (error: any) => {
  const text = String(error?.message ?? error ?? '').toLowerCase();
  return text.includes('duplicate') || text.includes('unique');
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ensureCron(req, res)) return;

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  try {
    const today = String(req.query?.target_date ?? '').trim() || getDateOnlyInTimeZone(new Date());
    const templatesRes = await supabase
      .from('ob_todo_templates')
      .select('id, creator_user_id, creator_email, creator_display_name, delivery_mode, title, content, due_at, anchor_instance_date, recurrence_kind, recurrence_rule, assignees, links')
      .eq('is_active', true)
      .neq('recurrence_kind', 'none');
    if (templatesRes.error) throw templatesRes.error;

    let createdItems = 0;
    const touchedTemplates: string[] = [];

    for (const template of ((templatesRes.data ?? []) as TodoTemplateRow[])) {
      const anchorDate = String(template.anchor_instance_date ?? '').trim();
      if (!anchorDate) continue;

      const existingItemsRes = await supabase
        .from('ob_todo_items')
        .select('instance_date, delivery_key')
        .eq('template_id', template.id);
      if (existingItemsRes.error) throw existingItemsRes.error;

      const existingRows = (existingItemsRes.data ?? []) as Array<{ instance_date?: string | null; delivery_key?: string | null }>;
      const existingKeys = new Set(
        existingRows
          .map((row) => {
            const instanceDate = String(row.instance_date ?? '').trim();
            const deliveryKey = String(row.delivery_key ?? '').trim();
            return instanceDate && deliveryKey ? `${instanceDate}__${deliveryKey}` : '';
          })
          .filter(Boolean)
      );
      const latestInstanceDate =
        existingRows
          .map((row) => String(row.instance_date ?? '').trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'en-US'))
          .slice(-1)[0] ?? anchorDate;

      const nextDates = listTodoOccurrenceDates(
        anchorDate,
        template.recurrence_kind,
        template.recurrence_rule ?? {},
        latestInstanceDate,
        today
      );
      if (!nextDates.length) continue;

      const assignees = normalizeAssignees(template.assignees);
      const links = normalizeLinks(template.links);
      const creatorEmail = String(template.creator_email ?? '').trim();
      const creatorDisplay = String(template.creator_display_name ?? '').trim() || creatorEmail || 'SYSTEM';

      for (const instanceDate of nextDates) {
        if (template.delivery_mode === 'shared') {
          const key = `${instanceDate}__shared`;
          if (existingKeys.has(key)) continue;
          const dueAt = buildTodoDueAtForInstance(template.due_at, instanceDate);
          try {
            const itemRes = await supabase
              .from('ob_todo_items')
              .insert({
                template_id: template.id,
                series_key: template.id,
                delivery_key: 'shared',
                instance_date: instanceDate,
                delivery_mode: 'shared',
                title: template.title,
                content: String(template.content ?? ''),
                due_at: dueAt,
                creator_user_id: template.creator_user_id,
                creator_email: creatorEmail,
                creator_display_name: creatorDisplay,
                status: 'open'
              })
              .select('id')
              .single();
            if (itemRes.error) throw itemRes.error;
            const itemId = String(itemRes.data?.id ?? '');
            if (!itemId) continue;
            if (assignees.length) {
              const assigneeRes = await supabase.from('ob_todo_item_assignees').insert(
                assignees.map((assignee) => ({
                  item_id: itemId,
                  assignee_user_id: assignee.user_id,
                  assignee_email: assignee.user_email,
                  assignee_display_name: assignee.display_name
                }))
              );
              if (assigneeRes.error) throw assigneeRes.error;
            }
            if (links.length) {
              const linkRes = await supabase.from('ob_todo_item_links').insert(
                links.map((link, index) => ({
                  item_id: itemId,
                  label: link.label,
                  url: link.url,
                  sort_order: index
                }))
              );
              if (linkRes.error) throw linkRes.error;
            }
            await supabase.from('ob_todo_events').insert({
              item_id: itemId,
              template_id: template.id,
              actor_display: 'SYSTEM',
              event_type: 'todo_generated',
              payload: { instance_date: instanceDate }
            });
            existingKeys.add(key);
            createdItems += 1;
            touchedTemplates.push(template.id);
          } catch (err) {
            if (!isDuplicateError(err)) throw err;
          }
          continue;
        }

        for (const assignee of assignees) {
          const key = `${instanceDate}__${assignee.user_id}`;
          if (existingKeys.has(key)) continue;
          const dueAt = buildTodoDueAtForInstance(template.due_at, instanceDate);
          try {
            const itemRes = await supabase
              .from('ob_todo_items')
              .insert({
                template_id: template.id,
                series_key: template.id,
                delivery_key: assignee.user_id,
                instance_date: instanceDate,
                delivery_mode: 'individual',
                title: template.title,
                content: String(template.content ?? ''),
                due_at: dueAt,
                creator_user_id: template.creator_user_id,
                creator_email: creatorEmail,
                creator_display_name: creatorDisplay,
                status: 'open'
              })
              .select('id')
              .single();
            if (itemRes.error) throw itemRes.error;
            const itemId = String(itemRes.data?.id ?? '');
            if (!itemId) continue;
            const assigneeRes = await supabase.from('ob_todo_item_assignees').insert({
              item_id: itemId,
              assignee_user_id: assignee.user_id,
              assignee_email: assignee.user_email,
              assignee_display_name: assignee.display_name
            });
            if (assigneeRes.error) throw assigneeRes.error;
            if (links.length) {
              const linkRes = await supabase.from('ob_todo_item_links').insert(
                links.map((link, index) => ({
                  item_id: itemId,
                  label: link.label,
                  url: link.url,
                  sort_order: index
                }))
              );
              if (linkRes.error) throw linkRes.error;
            }
            await supabase.from('ob_todo_events').insert({
              item_id: itemId,
              template_id: template.id,
              actor_display: 'SYSTEM',
              event_type: 'todo_generated',
              payload: { instance_date: instanceDate, assignee_user_id: assignee.user_id }
            });
            existingKeys.add(key);
            createdItems += 1;
            touchedTemplates.push(template.id);
          } catch (err) {
            if (!isDuplicateError(err)) throw err;
          }
        }
      }
    }

    res.status(200).json({
      status: 'ok',
      created_items: createdItems,
      touched_templates: Array.from(new Set(touchedTemplates))
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}

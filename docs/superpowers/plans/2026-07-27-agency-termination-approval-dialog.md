# Agency Termination Approval Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agency termination approval respond reliably and show a read-only detail grid containing staff ID, name, Agency, position, and the Agency-provided reason.

**Architecture:** Fix the generic dialog's conditional-hook defect with a focused regression test, then add a small normalization/orchestration module and a dedicated approval dialog. `AdminAppPage` owns the selected request, submit state, and visible error; the existing RPC remains the only persistence boundary.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Supabase JS v2, Vitest, Testing Library

---

## File Structure

- Modify `src/components/AppDialog.tsx`: make hook execution unconditional across closed/open renders.
- Create `src/admin/agencyTerminationApproval.ts`: normalize external request snapshot values and orchestrate approval plus refresh.
- Create `src/admin/pages/AgencyTerminationApprovalDialog.tsx`: render the selected read-only C-layout and deterministic submission state.
- Modify `src/admin/AdminAppPage.tsx`: open, submit, close, and report errors for the dedicated approval dialog.
- Create `tests/unit/appDialog.test.tsx`: reproduce and prevent the conditional-hook regression.
- Create `tests/unit/agencyTerminationApproval.test.ts`: test normalization and approval orchestration.
- Create `tests/unit/agencyTerminationApprovalDialog.test.tsx`: test the user-visible dialog behavior.

### Task 1: Reproduce and Fix the Generic Dialog Hook Failure

**Files:**
- Modify: `src/components/AppDialog.tsx`
- Create: `tests/unit/appDialog.test.tsx`

- [ ] **Step 1: Write the failing closed-to-open regression test**

```tsx
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import AppDialog from '../../src/components/AppDialog';

afterEach(cleanup);

describe('AppDialog', () => {
  test('can transition from closed to open without changing hook order', () => {
    const props = {
      title: '确认离职',
      message: '确认离职 US019737 吗？',
      onConfirm: vi.fn(),
      onCancel: vi.fn()
    };
    const view = render(<AppDialog {...props} open={false} />);

    expect(() => view.rerender(<AppDialog {...props} open />)).not.toThrow();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify the current component fails**

Run:

```powershell
npx vitest run tests/unit/appDialog.test.tsx
```

Expected: FAIL with a React hook-order error because the closed render returns before `useEffect` and `useMemo`.

- [ ] **Step 3: Move the conditional return below the hooks**

Keep `useEffect` and `useMemo` at the top level on every render:

```tsx
export default function AppDialog(props: AppDialogProps) {
  const {
    open,
    title = '提示',
    message,
    confirmText = '确定',
    cancelText = '取消',
    onConfirm,
    onCancel,
    tone = 'neutral',
    themeMode
  } = props;

  useEffect(() => {
    if (!open || !onCancel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  const mode = useMemo<'dark' | 'light'>(() => {
    if (themeMode) return themeMode;
    if (typeof document !== 'undefined') {
      const bodyTheme = String(document.body?.dataset?.theme ?? '').trim().toLowerCase();
      if (bodyTheme === 'light' || bodyTheme === 'dark') return bodyTheme;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }, [themeMode]);

  if (!open || typeof document === 'undefined') return null;

  // Preserve the existing portal markup and classes below this point.
}
```

Guard `document` and `window` inside the memo exactly as the current component does so server-side rendering remains safe.

- [ ] **Step 4: Run the regression test**

Run:

```powershell
npx vitest run tests/unit/appDialog.test.tsx
```

Expected: PASS with 1 test.

- [ ] **Step 5: Commit the isolated root-cause fix**

```powershell
git add -- src/components/AppDialog.tsx tests/unit/appDialog.test.tsx
git commit -m "Fix dialog hook ordering"
```

### Task 2: Normalize Request Details and Test Approval Orchestration

**Files:**
- Create: `src/admin/agencyTerminationApproval.ts`
- Create: `tests/unit/agencyTerminationApproval.test.ts`

- [ ] **Step 1: Write failing normalization and orchestration tests**

```ts
import { describe, expect, test, vi } from 'vitest';

import {
  executeAgencyTerminationApproval,
  normalizeAgencyTerminationDetails
} from '../../src/admin/agencyTerminationApproval';
import type { TerminationRequestRecord } from '../../src/admin/adminAccessApi';

const request: TerminationRequestRecord = {
  id: 'request-1',
  staff_id: ' US019737 ',
  agency: ' Prime ',
  requested_by_display: 'Agency User',
  reason: ' Attendance issue ',
  status: 'pending',
  review_note: '',
  created_at: '2026-07-27T10:00:00Z',
  reviewed_at: null,
  reviewed_by_user_id: null,
  employee_snapshot: { name: ' Karla Hernandez ', position: ' PACK ' }
};

describe('normalizeAgencyTerminationDetails', () => {
  test('normalizes the five read-only approval fields', () => {
    expect(normalizeAgencyTerminationDetails(request)).toEqual({
      staffId: 'US019737',
      name: 'Karla Hernandez',
      agency: 'Prime',
      position: 'PACK',
      reason: 'Attendance issue'
    });
  });

  test('uses dashes for invalid optional snapshot values', () => {
    expect(
      normalizeAgencyTerminationDetails({
        ...request,
        agency: '',
        reason: '',
        employee_snapshot: { name: null, position: { invalid: true } }
      })
    ).toEqual({
      staffId: 'US019737',
      name: '-',
      agency: '-',
      position: '-',
      reason: '-'
    });
  });
});

describe('executeAgencyTerminationApproval', () => {
  test('reviews before refreshing schedule and requests', async () => {
    const calls: string[] = [];
    await executeAgencyTerminationApproval({
      requestId: 'request-1',
      review: async (id) => calls.push(`review:${id}`),
      refreshSchedule: async () => calls.push('schedule'),
      refreshRequests: async () => calls.push('requests')
    });
    expect(calls[0]).toBe('review:request-1');
    expect(calls.slice(1).sort()).toEqual(['requests', 'schedule']);
  });

  test('does not refresh after a failed review', async () => {
    const refreshSchedule = vi.fn();
    const refreshRequests = vi.fn();
    await expect(
      executeAgencyTerminationApproval({
        requestId: 'request-1',
        review: async () => {
          throw new Error('RPC failed');
        },
        refreshSchedule,
        refreshRequests
      })
    ).rejects.toThrow('RPC failed');
    expect(refreshSchedule).not.toHaveBeenCalled();
    expect(refreshRequests).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run:

```powershell
npx vitest run tests/unit/agencyTerminationApproval.test.ts
```

Expected: FAIL because `src/admin/agencyTerminationApproval.ts` does not exist.

- [ ] **Step 3: Implement the typed normalization and orchestration module**

```ts
import type { TerminationRequestRecord } from './adminAccessApi';

export type AgencyTerminationDetails = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  reason: string;
};

const readText = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : '-';

export const normalizeAgencyTerminationDetails = (
  request: TerminationRequestRecord
): AgencyTerminationDetails => ({
  staffId: readText(request.staff_id),
  name: readText(request.employee_snapshot?.name),
  agency: readText(request.agency),
  position: readText(request.employee_snapshot?.position),
  reason: readText(request.reason)
});

type ApprovalDependencies = {
  requestId: string;
  review: (requestId: string) => Promise<unknown>;
  refreshSchedule: () => Promise<unknown>;
  refreshRequests: () => Promise<unknown>;
};

export const executeAgencyTerminationApproval = async ({
  requestId,
  review,
  refreshSchedule,
  refreshRequests
}: ApprovalDependencies): Promise<void> => {
  await review(requestId);
  await Promise.all([refreshSchedule(), refreshRequests()]);
};
```

- [ ] **Step 4: Run the focused module tests**

Run:

```powershell
npx vitest run tests/unit/agencyTerminationApproval.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit the domain module**

```powershell
git add -- src/admin/agencyTerminationApproval.ts tests/unit/agencyTerminationApproval.test.ts
git commit -m "Add agency termination approval logic"
```

### Task 3: Build the Dedicated Read-Only Approval Dialog

**Files:**
- Create: `src/admin/pages/AgencyTerminationApprovalDialog.tsx`
- Create: `tests/unit/agencyTerminationApprovalDialog.test.tsx`

- [ ] **Step 1: Write failing component tests**

```tsx
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import AgencyTerminationApprovalDialog from '../../src/admin/pages/AgencyTerminationApprovalDialog';

afterEach(cleanup);

const details = {
  staffId: 'US019737',
  name: 'Karla Hernandez',
  agency: 'Prime',
  position: 'PACK',
  reason: 'Attendance issue'
};

describe('AgencyTerminationApprovalDialog', () => {
  test('shows the five read-only request details', () => {
    render(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting={false}
        error=""
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText('US019737')).toBeInTheDocument();
    expect(screen.getByText('Karla Hernandez')).toBeInTheDocument();
    expect(screen.getByText('Prime')).toBeInTheDocument();
    expect(screen.getByText('PACK')).toBeInTheDocument();
    expect(screen.getByText('Attendance issue')).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('confirms once and disables actions while submitting', async () => {
    const onConfirm = vi.fn();
    const view = render(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting={false}
        error=""
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    view.rerender(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting
        error="RPC failed"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByRole('button', { name: '处理中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('RPC failed');
  });
});
```

- [ ] **Step 2: Run the tests and verify the component is missing**

Run:

```powershell
npx vitest run tests/unit/agencyTerminationApprovalDialog.test.tsx
```

Expected: FAIL because the dialog component does not exist.

- [ ] **Step 3: Implement the focused C-layout dialog**

Create a `role="dialog"` overlay with `aria-modal="true"`. Accept `themeMode: 'dark' | 'light'` and derive the panel, label, value, overlay, and error classes from it so the component follows the active admin theme. The dark branch uses the selected mockup:

```tsx
const rows = [
  [t('工号', 'Staff ID'), details.staffId],
  [t('姓名', 'Name'), details.name],
  ['Agency', details.agency],
  [t('岗位', 'Position'), details.position],
  [t('离职原因', 'Reason'), details.reason]
];

return (
  <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="agency-termination-title"
      className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-emerald-400/35 bg-slate-950 p-5 text-slate-100 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
    >
      <h2 id="agency-termination-title" className="font-display text-xl tracking-[0.08em]">
        {t('确认离职', 'Confirm Departure')}
      </h2>
      <dl className="mt-5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-200">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {error ? <div role="alert" className="mt-4 text-sm text-rose-300">{error}</div> : null}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="admin-btn admin-btn-toolbar admin-btn-secondary px-4" disabled={isSubmitting} onClick={onCancel}>
          {t('取消', 'Cancel')}
        </button>
        <button type="button" className="admin-btn admin-btn-toolbar admin-btn-primary px-4" disabled={isSubmitting} onClick={() => void onConfirm()}>
          {isSubmitting ? t('处理中', 'Processing') : t('确定', 'Confirm')}
        </button>
      </div>
    </section>
  </div>
);
```

Import `Fragment`, type `details` as `AgencyTerminationDetails`, and type `onConfirm` as `() => void | Promise<void>`.

- [ ] **Step 4: Run the component tests**

Run:

```powershell
npx vitest run tests/unit/agencyTerminationApprovalDialog.test.tsx
```

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the dialog**

```powershell
git add -- src/admin/pages/AgencyTerminationApprovalDialog.tsx tests/unit/agencyTerminationApprovalDialog.test.tsx
git commit -m "Add agency termination approval dialog"
```

### Task 4: Wire Approval into the Admin Schedule

**Files:**
- Modify: `src/admin/AdminAppPage.tsx:40-125`
- Modify: `src/admin/AdminAppPage.tsx:1500-1520`
- Modify: `src/admin/AdminAppPage.tsx:4089-4118`
- Modify: `src/admin/AdminAppPage.tsx:18908-18923`
- Modify: `src/admin/AdminAppPage.tsx:20390-20425`

- [ ] **Step 1: Import the dialog and domain functions**

```ts
import AgencyTerminationApprovalDialog from './pages/AgencyTerminationApprovalDialog';
import {
  executeAgencyTerminationApproval,
  normalizeAgencyTerminationDetails
} from './agencyTerminationApproval';
```

- [ ] **Step 2: Add explicit approval-dialog state**

Place beside `terminationRequests`:

```ts
const [terminationApprovalRequest, setTerminationApprovalRequest] =
  useState<TerminationRequestRecord | null>(null);
const [terminationApprovalSubmitting, setTerminationApprovalSubmitting] = useState(false);
const [terminationApprovalError, setTerminationApprovalError] = useState('');
```

- [ ] **Step 3: Replace approval's generic confirmation with open and submit handlers**

Keep rejection on the current `askConfirm` path. Add:

```ts
const openTerminationApproval = (request: TerminationRequestRecord) => {
  if (!scheduleCanReviewTermination || isLocked) return;
  setTerminationApprovalError('');
  setTerminationApprovalRequest(request);
};

const submitTerminationApproval = async () => {
  if (!supabase || !terminationApprovalRequest || terminationApprovalSubmitting) return;
  setTerminationApprovalSubmitting(true);
  setTerminationApprovalError('');
  try {
    await executeAgencyTerminationApproval({
      requestId: terminationApprovalRequest.id,
      review: (requestId) => reviewEmployeeTerminationRequest(supabase, requestId, 'approve'),
      refreshSchedule: () => refreshSchedulePanel({ lockUi: false }),
      refreshRequests: () => fetchTerminationRequests({ lockUi: false })
    });
    const staffId = terminationApprovalRequest.staff_id;
    setTerminationApprovalRequest(null);
    setStatus({
      tone: 'success',
      message: t(`已确认离职：${staffId}`, `Departure approved: ${staffId}`)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('离职审批失败。', 'Termination approval failed.');
    setTerminationApprovalError(message);
    setStatus({ tone: 'error', message });
  } finally {
    setTerminationApprovalSubmitting(false);
  }
};
```

Update `reviewTerminationRequest` so it only accepts the `'reject'` action or rename it to `rejectTerminationRequest`; it must keep the existing permission check, generic rejection confirmation, RPC call, status, and refresh behavior.

- [ ] **Step 4: Open the dedicated dialog from the schedule button**

Replace the approval button callback with:

```tsx
onClick={() => {
  if (pendingTerminationRequest) openTerminationApproval(pendingTerminationRequest);
}}
```

- [ ] **Step 5: Render the dialog near the existing departure dialog**

```tsx
{terminationApprovalRequest ? (
  <AgencyTerminationApprovalDialog
    t={t}
    details={normalizeAgencyTerminationDetails(terminationApprovalRequest)}
    themeMode={themeMode}
    isSubmitting={terminationApprovalSubmitting}
    error={terminationApprovalError}
    onCancel={() => {
      if (terminationApprovalSubmitting) return;
      setTerminationApprovalError('');
      setTerminationApprovalRequest(null);
    }}
    onConfirm={submitTerminationApproval}
  />
) : null}
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/appDialog.test.tsx tests/unit/agencyTerminationApproval.test.ts tests/unit/agencyTerminationApprovalDialog.test.tsx
```

Expected: PASS with 7 tests.

- [ ] **Step 7: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 8: Inspect the final diff and commit integration**

Run:

```powershell
git diff --check
git status --short
```

Confirm only the planned files plus the user's pre-existing unrelated changes are present. Then:

```powershell
git add -- src/admin/AdminAppPage.tsx
git commit -m "Wire agency termination approval dialog"
```

### Task 5: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run all directly affected tests fresh**

```powershell
npx vitest run tests/unit/appDialog.test.tsx tests/unit/agencyTerminationApproval.test.ts tests/unit/agencyTerminationApprovalDialog.test.tsx tests/unit/adminAccess.test.ts
```

Expected: all selected test files pass with zero failures.

- [ ] **Step 2: Run the production build fresh**

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Check the working tree without modifying unrelated files**

```powershell
git status --short
git log -5 --oneline
```

Verify the feature commits exist and the user's pre-existing migration/test changes remain untouched.

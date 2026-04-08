import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '../lib/supabase';
import { hasModuleAccess, getModuleMapFromContext, type AdminAccessContext } from '../shared/adminAccess';
import {
  canEditAgencyPlannedLeave,
  isAgencyWorkingState,
  type AgencyShift
} from '../shared/agencyShared';
import {
  createAgencyTerminationRequest,
  fetchAdminAccessContext,
  fetchAgencyBoard,
  fetchAgencyUserDisplayName,
  submitAgencyPlannedLeave,
  submitAgencySubstitute,
  upsertAgencyNewHireDemand
} from './api';
import type { AgencyBoard, AgencyEmployeeRow, AgencyNewHireRequestRow, AgencyUpsertNewHireInput } from './types';

type ModalState = 'leave' | 'substitute' | 'new_hire' | 'termination' | null;

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { hour12: false });
};

const stateLabel = (state: string) => {
  if (state === 'fixed_work') return 'Fixed';
  if (state === 'temp_work') return 'Substitute';
  if (state === 'planned_temp_work') return 'Planned Substitute';
  if (state === 'planned_leave') return 'Planned Leave';
  if (state === 'temp_rest') return 'Temp Rest';
  if (state === 'planned_temp_rest') return 'Planned Rest';
  return state.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const stateChipClass = (state: string) => {
  if (state === 'planned_leave' || state === 'leave') return 'border-rose-400/30 bg-rose-500/10 text-rose-200';
  if (state === 'temp_work' || state === 'planned_temp_work' || state === 'fixed_work' || state === 'work')
    return 'border-sky-400/30 bg-sky-500/10 text-sky-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

const cardClass = 'rounded-[28px] border border-white/10 bg-black/20 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.25)]';
const inputClass =
  'h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]';
const buttonClass =
  'inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';
const neonButtonClass =
  'inline-flex h-10 items-center justify-center rounded-2xl bg-neon px-4 text-sm font-semibold text-slate-950 transition hover:shadow-[0_12px_30px_rgba(158,255,0,0.25)] disabled:cursor-not-allowed disabled:opacity-50';

const Modal = ({
  open,
  title,
  children
}: {
  open: boolean;
  title: string;
  children: ReactNode;
}) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-xl rounded-[32px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-2xl tracking-[0.04em] text-white">{title}</h3>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};

const LoginPanel = ({
  email,
  password,
  setEmail,
  setPassword,
  onLogin,
  busy
}: {
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onLogin: () => void | Promise<void>;
  busy: boolean;
}) => (
  <section className={[cardClass, 'mx-auto max-w-md'].join(' ')}>
    <div className="text-sm uppercase tracking-[0.24em] text-slate-400">Agency Board</div>
    <h1 className="mt-4 font-display text-4xl tracking-[0.04em] text-white">Sign In</h1>
    <div className="mt-6 grid gap-4">
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className={inputClass} />
      <input
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        placeholder="Password"
        className={inputClass}
      />
      <button type="button" disabled={busy || !email.trim() || !password} onClick={() => void onLogin()} className={neonButtonClass}>
        Sign In
      </button>
    </div>
  </section>
);

export default function AgencyAppPage() {
  const [supabase] = useState(() => createSupabaseClient({ persistSession: true }));
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<AdminAccessContext | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [board, setBoard] = useState<AgencyBoard | null>(null);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<AgencyEmployeeRow | null>(null);
  const [selectedNewHire, setSelectedNewHire] = useState<AgencyNewHireRequestRow | null>(null);
  const [leaveReason, setLeaveReason] = useState('');
  const [terminationReason, setTerminationReason] = useState('');
  const [substituteStaffId, setSubstituteStaffId] = useState('');
  const [newHireForm, setNewHireForm] = useState<AgencyUpsertNewHireInput>({
    staffId: null,
    workDate: selectedDate,
    position: 'Pick',
    shift: 'early',
    agency: '',
    label: '',
    entryTime: '',
    note: '',
    count: 1
  });

  const moduleMap = useMemo(() => getModuleMapFromContext(access), [access]);
  const canViewAgency = hasModuleAccess(moduleMap, 'agency', 'view');
  const canOperateAgency = hasModuleAccess(moduleMap, 'agency', 'operate');

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
    });
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      subscription.data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;
    const loadContext = async () => {
      if (!supabase || !user) {
        setAccess(null);
        setDisplayName('');
        return;
      }
      try {
        const [nextAccess, nextDisplayName] = await Promise.all([
          fetchAdminAccessContext(supabase, user.email),
          fetchAgencyUserDisplayName(supabase, user.id)
        ]);
        if (!active) return;
        setAccess(nextAccess);
        setDisplayName(nextDisplayName);
      } catch (nextError) {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed to load access context.');
      }
    };
    void loadContext();
    return () => {
      active = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!selectedDate) return;
    setNewHireForm((prev) => ({ ...prev, workDate: selectedDate, agency: access?.managed_agencies[0] ?? prev.agency }));
  }, [selectedDate, access?.managed_agencies]);

  const refreshBoard = async () => {
    if (!supabase || !user || !canViewAgency) return;
    setBusy(true);
    setError(null);
    try {
      const nextBoard = await fetchAgencyBoard(supabase, selectedDate);
      setBoard(nextBoard);
      setStatus(`Loaded ${nextBoard.employees.length} employees`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load board.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshBoard();
  }, [selectedDate, supabase, user?.id, canViewAgency]);

  const doLogin = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message);
      setPassword('');
      setStatus('Signed in');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setStatus('Signed out');
  };

  const eligibleSubstitutes = useMemo(() => {
    if (!selectedEmployee || !board) return [];
    return board.employees.filter(
      (employee) =>
        employee.staff_id !== selectedEmployee.staff_id &&
        employee.position === selectedEmployee.position &&
        employee.fixed_work_count < 5 &&
        !['work', 'fixed_work', 'temp_work'].includes(employee.state)
    );
  }, [board, selectedEmployee]);

  const openLeaveModal = (employee: AgencyEmployeeRow) => {
    setSelectedEmployee(employee);
    setLeaveReason('');
    setModal('leave');
  };

  const openSubstituteModal = (employee: AgencyEmployeeRow) => {
    setSelectedEmployee(employee);
    setSubstituteStaffId('');
    setModal('substitute');
  };

  const openTerminationModal = (employee: AgencyEmployeeRow) => {
    setSelectedEmployee(employee);
    setTerminationReason('');
    setModal('termination');
  };

  const openCreateNewHire = () => {
    setSelectedNewHire(null);
    setNewHireForm({
      staffId: null,
      workDate: selectedDate,
      position: 'Pick',
      shift: 'early',
      agency: access?.managed_agencies[0] ?? '',
      label: '',
      entryTime: '',
      note: '',
      count: 1
    });
    setModal('new_hire');
  };

  const openEditNewHire = (row: AgencyNewHireRequestRow) => {
    setSelectedNewHire(row);
    setNewHireForm({
      staffId: row.staff_id,
      workDate: selectedDate,
      position: row.position,
      shift: row.shift === 'late' ? 'late' : 'early',
      agency: row.agency,
      label: row.label,
      entryTime: '',
      note: row.name,
      count: 1
    });
    setModal('new_hire');
  };

  const closeModal = () => {
    setModal(null);
    setSelectedEmployee(null);
    setSelectedNewHire(null);
  };

  const submitLeave = async () => {
    if (!supabase || !selectedEmployee) return;
    setBusy(true);
    try {
      await submitAgencyPlannedLeave(supabase, selectedEmployee.staff_id, selectedDate, leaveReason);
      setStatus(`Planned leave saved for ${selectedEmployee.name}`);
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Leave update failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitSubstitute = async () => {
    if (!supabase || !selectedEmployee || !substituteStaffId) return;
    setBusy(true);
    try {
      await submitAgencySubstitute(supabase, selectedEmployee.staff_id, substituteStaffId, selectedDate);
      setStatus('Substitute assigned');
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Substitute update failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitNewHire = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await upsertAgencyNewHireDemand(supabase, newHireForm);
      setStatus(selectedNewHire ? 'New request updated' : 'New request created');
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'New request save failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitTermination = async () => {
    if (!supabase || !selectedEmployee || !terminationReason.trim()) return;
    setBusy(true);
    try {
      await createAgencyTerminationRequest(supabase, selectedEmployee.staff_id, terminationReason.trim());
      setStatus('Termination request submitted');
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Termination request failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!supabase) {
    return <div className="min-h-screen px-6 py-10 text-white">Missing Supabase configuration.</div>;
  }

  return (
    <div className="min-h-screen px-5 py-8 text-paper">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-6">
        <header className={[cardClass, 'flex flex-wrap items-start justify-between gap-6'].join(' ')}>
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">ObPunch Agency</div>
            <h1 className="mt-4 font-display text-5xl tracking-[0.04em] text-white">Agency Board</h1>
            <div className="mt-3 text-sm text-slate-400">{displayName || user?.email || 'Signed out'}</div>
          </div>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className={inputClass} />
            {user ? (
              <>
                <button type="button" onClick={() => void refreshBoard()} className={buttonClass} disabled={busy || !canViewAgency}>
                  Refresh
                </button>
                <button type="button" onClick={openCreateNewHire} className={neonButtonClass} disabled={busy || !canOperateAgency}>
                  New Request
                </button>
                <button type="button" onClick={() => void doLogout()} className={buttonClass} disabled={busy}>
                  Logout
                </button>
              </>
            ) : null}
          </div>
        </header>

        {!user ? <LoginPanel email={email} password={password} setEmail={setEmail} setPassword={setPassword} onLogin={doLogin} busy={busy} /> : null}

        {user && !canViewAgency ? (
          <section className={cardClass}>
            <div className="text-sm text-rose-200">This account does not have access to the Agency module.</div>
          </section>
        ) : null}

        {error ? <section className={cardClass}><div className="text-sm text-rose-200">{error}</div></section> : null}

        {user && canViewAgency && board ? (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              {board.summary_cards.map((card) => (
                <div key={card.key} className={cardClass}>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{card.label}</div>
                  <div className="mt-4 text-4xl font-semibold text-white">{card.value}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              {board.attendance_cards.map((card) => (
                <div key={card.key} className={cardClass}>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{card.label}</div>
                  <div className="mt-4 text-4xl font-semibold text-white">{card.value}</div>
                </div>
              ))}
            </section>

            <section className={cardClass}>
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="font-display text-3xl tracking-[0.04em] text-white">Employees</h2>
                <div className="text-sm text-slate-400">{board.employees.length} rows</div>
              </div>
              <div className="space-y-3">
                {board.employees.map((employee) => {
                  const leaveLocked = !canEditAgencyPlannedLeave((employee.shift || 'early') as AgencyShift, selectedDate, new Date());
                  return (
                    <div key={employee.staff_id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="text-lg font-semibold text-white">{employee.name}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            {employee.staff_id} · {employee.agency || '-'} · {employee.position || '-'} · {employee.shift || '-'}
                          </div>
                        </div>
                        <span className={['rounded-full border px-3 py-1 text-xs font-semibold', stateChipClass(employee.state)].join(' ')}>
                          {stateLabel(employee.state)}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy || !canOperateAgency || !isAgencyWorkingState(employee.state) || leaveLocked}
                          onClick={() => openLeaveModal(employee)}
                        >
                          Plan Leave
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy || !canOperateAgency || !['leave', 'planned_leave'].includes(employee.state)}
                          onClick={() => openSubstituteModal(employee)}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy || !canOperateAgency || employee.termination_status === 'pending'}
                          onClick={() => openTerminationModal(employee)}
                        >
                          {employee.termination_status === 'pending' ? 'Pending Termination' : 'Terminate'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={[cardClass, 'grid gap-5 lg:grid-cols-[1.3fr_1fr]'].join(' ')}>
              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="font-display text-3xl tracking-[0.04em] text-white">New Requests</h2>
                  <button type="button" className={buttonClass} disabled={busy || !canOperateAgency} onClick={openCreateNewHire}>
                    Create
                  </button>
                </div>
                <div className="space-y-3">
                  {board.new_hire_requests.length === 0 ? <div className="text-sm text-slate-400">No new requests.</div> : null}
                  {board.new_hire_requests.map((row) => (
                    <div key={row.staff_id} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{row.staff_id}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            {row.agency || '-'} · {row.position || '-'} · {row.shift || '-'}
                          </div>
                        </div>
                        <button type="button" className={buttonClass} disabled={busy || !canOperateAgency} onClick={() => openEditNewHire(row)}>
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="mb-4 font-display text-3xl tracking-[0.04em] text-white">Logs</h2>
                <div className="space-y-3">
                  {board.logs.length === 0 ? <div className="text-sm text-slate-400">No logs.</div> : null}
                  {board.logs.map((log) => (
                    <div key={String(log.id)} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{log.action}</div>
                      <div className="mt-2 text-sm text-white">{log.actor || '-'}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatDateTime(log.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : null}

        <div className="text-center text-xs text-slate-500">{status}</div>
      </div>

      <Modal open={modal === 'leave'} title="Plan Leave">
        <div className="space-y-4">
          <textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} rows={4} className={[inputClass, 'h-auto py-3'].join(' ')} placeholder="Reason" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
            <button type="button" onClick={() => void submitLeave()} className={neonButtonClass} disabled={busy}>Save</button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'substitute'} title="Assign Substitute">
        <div className="space-y-4">
          <select value={substituteStaffId} onChange={(event) => setSubstituteStaffId(event.target.value)} className={inputClass}>
            <option value="">Select employee</option>
            {eligibleSubstitutes.map((employee) => (
              <option key={employee.staff_id} value={employee.staff_id}>
                {employee.name} ({employee.staff_id})
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
            <button type="button" onClick={() => void submitSubstitute()} className={neonButtonClass} disabled={busy || !substituteStaffId}>
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'new_hire'} title={selectedNewHire ? 'Edit Request' : 'New Request'}>
        <div className="grid gap-4 md:grid-cols-2">
          <input value={newHireForm.staffId ?? ''} readOnly placeholder="Employee ID" className={inputClass} />
          <input value={newHireForm.agency} onChange={(event) => setNewHireForm((prev) => ({ ...prev, agency: event.target.value }))} placeholder="Agency" className={inputClass} />
          <input value={newHireForm.position} onChange={(event) => setNewHireForm((prev) => ({ ...prev, position: event.target.value }))} placeholder="Position" className={inputClass} />
          <select value={newHireForm.shift} onChange={(event) => setNewHireForm((prev) => ({ ...prev, shift: event.target.value as 'early' | 'late' }))} className={inputClass}>
            <option value="early">Morning</option>
            <option value="late">Night</option>
          </select>
          <input value={newHireForm.label} onChange={(event) => setNewHireForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Label" className={inputClass} />
          <input value={newHireForm.entryTime} onChange={(event) => setNewHireForm((prev) => ({ ...prev, entryTime: event.target.value }))} placeholder="Entry time" className={inputClass} />
          <input value={newHireForm.count} type="number" min={1} max={200} onChange={(event) => setNewHireForm((prev) => ({ ...prev, count: Math.max(1, Math.min(200, Number(event.target.value) || 1)) }))} className={inputClass} disabled={Boolean(selectedNewHire)} />
          <input value={newHireForm.workDate} readOnly className={inputClass} />
          <textarea value={newHireForm.note} onChange={(event) => setNewHireForm((prev) => ({ ...prev, note: event.target.value }))} rows={4} className={['md:col-span-2', inputClass, 'h-auto py-3'].join(' ')} placeholder="Note" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
          <button type="button" onClick={() => void submitNewHire()} className={neonButtonClass} disabled={busy || !newHireForm.agency.trim() || !newHireForm.position.trim()}>
            Save
          </button>
        </div>
      </Modal>

      <Modal open={modal === 'termination'} title="Termination Request">
        <div className="space-y-4">
          <textarea value={terminationReason} onChange={(event) => setTerminationReason(event.target.value)} rows={4} className={[inputClass, 'h-auto py-3'].join(' ')} placeholder="Reason" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
            <button type="button" onClick={() => void submitTermination()} className={neonButtonClass} disabled={busy || !terminationReason.trim()}>
              Submit
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

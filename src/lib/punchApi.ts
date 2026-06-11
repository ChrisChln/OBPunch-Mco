export type PunchApiAction = 'IN' | 'OUT';
export type PunchApiRequestAction = PunchApiAction | 'AUTO';

type SubmitPunchArgs = {
  staffId: string;
  action: PunchApiRequestAction;
};

type SubmitPunchResult =
  | {
      ok: true;
      staffId: string;
      action: PunchApiAction;
    }
  | {
      ok: false;
      error: string;
    };

const readErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    const message = String(payload.error ?? '').trim();
    return message || `Punch failed with status ${response.status}.`;
  } catch {
    return `Punch failed with status ${response.status}.`;
  }
};

export const submitPunchToApi = async ({ staffId, action }: SubmitPunchArgs): Promise<SubmitPunchResult> => {
  try {
    const response = await fetch('/api/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, action })
    });

    if (!response.ok) {
      return { ok: false, error: await readErrorMessage(response) };
    }

    const payload = (await response.json()) as { staff_id?: unknown; action?: unknown };
    const responseAction = String(payload.action ?? action).toUpperCase();
    return {
      ok: true,
      staffId: String(payload.staff_id ?? staffId).trim(),
      action: responseAction === 'OUT' ? 'OUT' : 'IN'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Punch API request failed: ${message}` };
  }
};

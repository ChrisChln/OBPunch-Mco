export const isExactOperationalCutoffOut = (atRaw: string, actionRaw: unknown, cutoffHour: number) => {
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) return false;
  const action = String(actionRaw ?? '').trim().toUpperCase();
  return action === 'OUT' && at.getHours() === cutoffHour && at.getMinutes() === 0 && at.getSeconds() === 0;
};

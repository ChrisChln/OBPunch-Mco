export const formatPunchFailureSummary = (error: unknown) => {
  const detail = String(error ?? '').trim();
  return detail ? `Punch failed: ${detail}` : 'Punch failed';
};

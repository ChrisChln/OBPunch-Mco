export function shouldUseTimecardWeekCache({
  cachedWeekKey,
  requestedWeekKey,
  bypassCache
}: {
  cachedWeekKey: string | null | undefined;
  requestedWeekKey: string;
  bypassCache: boolean;
}) {
  return !bypassCache && cachedWeekKey === requestedWeekKey;
}

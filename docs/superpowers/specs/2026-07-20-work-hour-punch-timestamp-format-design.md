# Work Hour Punch Timestamp Format Design

## Goal

Change timestamps in the Work Hour Comparison punch-flow modal from slash-separated dates to the fixed local format `YYYY-MM-DD HH:mm:ss`.

- Before: `2026/07/17 15:50:12`
- After: `2026-07-17 15:50:12`

## Scope

- Update only the punch-flow formatter used by `WorkHourComparisonPage`.
- Preserve local-time interpretation, the 24-hour clock, and the `-` fallback for invalid values.
- Do not change the modal layout, punch data, comparison calculations, or other pages.

## Implementation

Keep the formatter local to the feature. Parse the supplied value, reject invalid dates, read the local date/time components, zero-pad them, and return `YYYY-MM-DD HH:mm:ss`. This avoids browser-dependent locale separators.

## Testing

- Test valid timestamp output with hyphen separators.
- Test the invalid timestamp fallback.
- Run the targeted unit test and production build.

## Acceptance Criteria

- The modal Time column displays values such as `2026-07-17 15:50:12`.
- Output remains local-time based and uses a 24-hour clock.
- Invalid timestamps display `-`.
- Other pages keep their existing formats.

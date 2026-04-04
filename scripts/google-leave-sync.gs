const LEAVE_SYNC_URL = 'https://YOUR-DOMAIN/api/leave-sync';
const LEAVE_SYNC_TOKEN = 'YOUR_GOOGLE_SHEET_SYNC_TOKEN';

function syncLeaveRowFromEvent(e) {
  if (!e || !e.range) throw new Error('Missing form submit event payload.');
  const sheet = e.range && e.range.getSheet ? e.range.getSheet() : null;
  const spreadsheet = sheet ? sheet.getParent() : null;
  if (!sheet) throw new Error('Missing target sheet.');
  const rowNumber = e.range.getRow();
  SpreadsheetApp.flush();
  Utilities.sleep(1200);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] || [];
  const values = sheet.getRange(rowNumber, 1, 1, headers.length).getDisplayValues()[0] || [];
  const record = {};
  for (let i = 0; i < headers.length; i += 1) record[headers[i]] = values[i];
  const row = {
    source: 'google_form',
    sheet_id: spreadsheet ? spreadsheet.getId() : '',
    sheet_name: sheet ? sheet.getName() : '',
    row_number: rowNumber,
    ...record
  };
  postLeaveRows([row]);
}

function syncAllLeaveRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length < 2) throw new Error('No data rows found.');
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i += 1) {
    const record = {};
    for (let j = 0; j < headers.length; j += 1) record[headers[j]] = values[i][j];
    record.source = 'google_form';
    record.sheet_id = sheet.getParent().getId();
    record.sheet_name = sheet.getName();
    record.row_number = i + 1;
    rows.push(record);
  }
  postLeaveRows(rows);
}

function postLeaveRows(rows) {
  const response = UrlFetchApp.fetch(LEAVE_SYNC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LEAVE_SYNC_TOKEN },
    payload: JSON.stringify({ rows }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('leave-sync failed: ' + code + ' ' + text);
  Logger.log(text);
  return JSON.parse(text);
}

function flattenNamedValues(namedValues) {
  const out = {};
  Object.keys(namedValues || {}).forEach((key) => {
    const value = namedValues[key];
    out[key] = Array.isArray(value) ? value[0] : value;
  });
  return out;
}

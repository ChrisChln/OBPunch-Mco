import { describe, expect, test } from 'vitest';
import {
  buildExceptionEditItemRows,
  buildExceptionInsertPayload,
  buildExceptionUpdatePayload,
  buildExceptionPrintPayload,
  inferExceptionStatus,
  isValidExceptionTransition,
  needsInventoryAdjustment,
  normalizeExceptionMultiLineText,
  splitExceptionReportItemRows,
  validateExceptionReportInput,
  type ExceptionReportInput,
  type ExceptionReportRecord
} from '../../src/shared/exceptionReports';

const validInput = (): ExceptionReportInput => ({
  report_date: '2026-06-18',
  exception_type: 'short_pick',
  product_barcode: 'SKU123',
  picking_list_number: 'PL-1',
  picking_container: 'C-1',
  picking_operator: 'US100',
  packing_rebin_operator: '',
  picked_location: 'A01',
  system_location_qty: 5,
  actual_qty: 4,
  count_by: 'US200',
  borrowed_location: '',
  borrowed_qty: '',
  inventory_adjustment: false,
  submitted_by_lead_id: 'US300'
});

describe('exceptionReports', () => {
  test('validates required fields and non-negative quantities', () => {
    expect(validateExceptionReportInput(validInput())).toEqual([]);

    const errors = validateExceptionReportInput({
      ...validInput(),
      product_barcode: '',
      actual_qty: -1
    });
    expect(errors).toContain('Product barcode is required.');
    expect(errors).toContain('Actual qty must be a non-negative number.');
  });

  test('requires borrowed qty when borrowed location is filled', () => {
    const errors = validateExceptionReportInput({
      ...validInput(),
      borrowed_location: 'B02',
      borrowed_qty: ''
    });
    expect(errors).toContain('Borrowed qty is required when borrowed location is filled.');
  });

  test('allows minimal reports and keeps blank quantities empty', () => {
    const input: ExceptionReportInput = {
      ...validInput(),
      exception_type: '',
      picking_container: '',
      picking_operator: '',
      picked_location: '',
      system_location_qty: '',
      actual_qty: '',
      count_by: '',
      product_barcode: 'sku123',
      picking_list_number: 'PL-1'
    };

    expect(validateExceptionReportInput(input)).toEqual([]);
    const payload = buildExceptionInsertPayload(input);
    expect(payload?.exception_type).toBeNull();
    expect(payload?.system_location_qty).toBeNull();
    expect(payload?.actual_qty).toBeNull();
  });

  test('requires Count By whenever counted quantities are entered', () => {
    const input: ExceptionReportInput = {
      ...validInput(),
      count_by: ''
    };

    expect(validateExceptionReportInput(input, { requireCountByForQuantities: true })).toContain(
      'Count By USID is required when counted quantities are entered.'
    );
    expect(validateExceptionReportInput({ ...input, system_location_qty: '', actual_qty: '' }, { requireCountByForQuantities: true })).toEqual([]);
  });

  test('requires Count By for legacy top-level quantities even when item rows are present', () => {
    const input: ExceptionReportInput = {
      ...validInput(),
      count_by: '',
      item_rows: [{ product_barcode: 'SKU123', picked_location: 'A01', system_location_qty: '', actual_qty: '' }]
    };

    expect(validateExceptionReportInput(input, { requireCountByForQuantities: true })).toContain(
      'Count By USID is required when counted quantities are entered.'
    );
  });

  test('requires a reason for Other exception type', () => {
    expect(
      validateExceptionReportInput({
        ...validInput(),
        exception_type: 'other',
        resolution_note: ''
      })
    ).toContain('Reason is required for Other.');

    const input = {
      ...validInput(),
      exception_type: 'other',
      resolution_note: 'Mixed item issue'
    };
    expect(validateExceptionReportInput(input)).toEqual([]);
    const payload = buildExceptionInsertPayload(input);
    expect(payload?.exception_type).toBe('other');
    expect(payload?.resolution_note).toBe('Mixed item issue');
  });

  test('builds a normalized update payload from edited report fields', () => {
    const payload = buildExceptionUpdatePayload({
      ...validInput(),
      product_barcode: ' sku123 ',
      picking_operator: ' us100 ',
      borrowed_location: ' b02 ',
      borrowed_qty: '2',
      extra_taken: true,
      resolution_note: ' checked '
    });

    expect(payload?.product_barcode).toBe('SKU123');
    expect(payload?.picking_operator).toBe('US100');
    expect(payload?.borrowed_location).toBe('B02');
    expect(payload?.borrowed_qty).toBe(2);
    expect(payload?.extra_taken).toBe(true);
    expect(payload?.resolution_note).toBe('checked');
  });

  test('normalizes multiple item rows without losing row alignment', () => {
    expect(normalizeExceptionMultiLineText(' sku123 \n \n sku456 ', true)).toBe('SKU123\n\nSKU456');

    const payload = buildExceptionInsertPayload({
      ...validInput(),
      product_barcode: ' sku123 \nsku456 ',
      picked_location: ' a01 \nb02 ',
      item_rows: [
        { product_barcode: ' sku123 ', picked_location: ' a01 ', system_location_qty: '5', actual_qty: '4' },
        { product_barcode: ' sku456 ', picked_location: ' b02 ', system_location_qty: '3', actual_qty: '2' }
      ]
    });
    expect(payload?.product_barcode).toBe('SKU123\nSKU456');
    expect(payload?.picked_location).toBe('A01\nB02');
    expect(payload?.picking_container).toBe('C-1');
    expect(payload?.system_location_qty).toBe(5);
    expect(payload?.actual_qty).toBe(4);
    expect(payload?.item_rows).toEqual([
      { product_barcode: 'SKU123', picked_location: 'A01', system_location_qty: 5, actual_qty: 4 },
      { product_barcode: 'SKU456', picked_location: 'B02', system_location_qty: 3, actual_qty: 2 }
    ]);
  });

  test('splits printable item rows with independent quantities', () => {
    expect(
      splitExceptionReportItemRows({
        ...validInput(),
        product_barcode: 'SKU123\nSKU456',
        picked_location: 'A01\nB02',
        item_rows: [
          { product_barcode: 'SKU123', picked_location: 'A01', system_location_qty: 5, actual_qty: 4 },
          { product_barcode: 'SKU456', picked_location: 'B02', system_location_qty: 3, actual_qty: 2 }
        ]
      })
    ).toEqual([
      { product_barcode: 'SKU123', picked_location: 'A01', system_location_qty: 5, actual_qty: 4 },
      { product_barcode: 'SKU456', picked_location: 'B02', system_location_qty: 3, actual_qty: 2 }
    ]);
  });

  test('keeps empty editable item rows visible when adding a blank row', () => {
    expect(
      buildExceptionEditItemRows(
        {
          product_barcode: '',
          picked_location: ''
        },
        2
      )
    ).toEqual([
      { product: '', location: '', systemQty: '', actualQty: '' },
      { product: '', location: '', systemQty: '', actualQty: '' }
    ]);
  });

  test('allows only forward status transitions', () => {
    expect(isValidExceptionTransition('Open', 'Processing')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Counted')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Resolved')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Short Picked')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Pending Adjustment')).toBe(true);
    expect(isValidExceptionTransition('Counted', 'Pending Adjustment')).toBe(true);
    expect(isValidExceptionTransition('Counted', 'Resolved')).toBe(true);
    expect(isValidExceptionTransition('Pending Adjustment', 'Resolved')).toBe(true);
    expect(isValidExceptionTransition('Resolved', 'Closed')).toBe(true);
    expect(isValidExceptionTransition('Open', 'Closed')).toBe(true);
    expect(isValidExceptionTransition('Closed', 'Open')).toBe(true);
    expect(isValidExceptionTransition('Open', 'Resolved')).toBe(false);
    expect(isValidExceptionTransition('Resolved', 'Processing')).toBe(false);
    expect(isValidExceptionTransition('Closed', 'Processing')).toBe(false);
  });

  test('detects pending inventory adjustments after borrowing from another location', () => {
    expect(needsInventoryAdjustment({ borrowed_location: 'B02', inventory_adjustment: false })).toBe(true);
    expect(needsInventoryAdjustment({ borrowed_location: 'B02', inventory_adjustment: true })).toBe(false);
    expect(needsInventoryAdjustment({ borrowed_location: '', inventory_adjustment: false })).toBe(false);
  });

  test('validates inventory adjustment scope for extra taken', () => {
    expect(validateExceptionReportInput({ ...validInput(), inventory_adjustment: true })).toContain(
      'Inventory adjustment requires borrowed inventory or extra taken.'
    );
    expect(validateExceptionReportInput({ ...validInput(), system_location_qty: 3, actual_qty: 3, extra_taken: true, inventory_adjustment: true })).toEqual([]);
    expect(validateExceptionReportInput({ ...validInput(), system_location_qty: 3, actual_qty: 2, extra_taken: true, inventory_adjustment: true })).toEqual([]);
    expect(validateExceptionReportInput({ ...validInput(), system_location_qty: 3, actual_qty: 4, extra_taken: true })).toContain(
      'Extra taken can only be marked when counted stock still needs replenishment.'
    );
  });

  test('infers status from completed workflow fields', () => {
    const baseCreated = { ...validInput(), system_location_qty: '', actual_qty: '', picking_operator: '', packing_rebin_operator: '', count_by: '' };
    const processingComplete = { ...validInput(), packing_rebin_operator: 'US400' };
    const pickerShortPickEvidence = { ...processingComplete, system_location_qty: 3, actual_qty: 4 };
    const matchedStockStillNeedsReplenishment = { ...processingComplete, system_location_qty: 3, actual_qty: 3 };
    const shortStockStillNeedsReplenishment = { ...processingComplete, system_location_qty: 3, actual_qty: 2 };
    expect(inferExceptionStatus(baseCreated)).toBe('Open');
    expect(inferExceptionStatus({ ...validInput(), actual_qty: '', packing_rebin_operator: '', count_by: '' })).toBe('Processing');
    expect(inferExceptionStatus({ ...validInput(), packing_rebin_operator: '', count_by: '' })).toBe('Counted');
    expect(inferExceptionStatus({ ...validInput(), packing_rebin_operator: 'US400', count_by: '' })).toBe('Counted');
    expect(inferExceptionStatus(pickerShortPickEvidence)).toBe('Resolved');
    expect(inferExceptionStatus(matchedStockStillNeedsReplenishment)).toBe('Processing');
    expect(inferExceptionStatus(shortStockStillNeedsReplenishment)).toBe('Processing');
    expect(inferExceptionStatus({ ...processingComplete, borrowed_location: 'B02', borrowed_qty: '2', inventory_adjustment: false })).toBe('Pending Adjustment');
    expect(inferExceptionStatus({ ...processingComplete, borrowed_location: 'B02', borrowed_qty: '2', inventory_adjustment: true })).toBe('Resolved');
    expect(inferExceptionStatus({ ...matchedStockStillNeedsReplenishment, extra_taken: true, inventory_adjustment: false })).toBe('Pending Adjustment');
    expect(inferExceptionStatus({ ...matchedStockStillNeedsReplenishment, extra_taken: true, inventory_adjustment: true })).toBe('Resolved');
    expect(inferExceptionStatus({ ...shortStockStillNeedsReplenishment, extra_taken: true, inventory_adjustment: false })).toBe('Pending Adjustment');
    expect(inferExceptionStatus({ ...shortStockStillNeedsReplenishment, extra_taken: true, inventory_adjustment: true })).toBe('Resolved');
    expect(inferExceptionStatus({ ...processingComplete, exception_type: 'short_shipment', actual_qty: 0, short_picked: true })).toBe('Short Picked');
    expect(inferExceptionStatus({ ...validInput(), exception_type: 'short_shipment', actual_qty: 0, packing_rebin_operator: '', count_by: '', short_picked: true })).toBe('Short Picked');
  });

  test('persists short picked only for Short Pick zero-actual reports', () => {
    const payload = buildExceptionInsertPayload({
      ...validInput(),
      exception_type: 'short_shipment',
      packing_rebin_operator: 'US400',
      actual_qty: 0,
      short_picked: true
    });
    expect(payload?.short_picked).toBe(true);
    expect(
      buildExceptionInsertPayload({
        ...validInput(),
        exception_type: 'short_pick',
        actual_qty: 0,
        short_picked: true
      })?.short_picked
    ).toBe(false);
  });

  test('maps all key report fields into the 4x6 print payload', () => {
    const report: ExceptionReportRecord = {
      ...validInput(),
      id: 99,
      report_number: '202606180001',
      status: 'Resolved',
      borrowed_qty: null,
      responsible_staff_id: 'US500',
      responsibility_result: 'responsible',
      mistake_report_id: 12,
      created_at: '2026-06-18T10:00:00Z',
      updated_at: '2026-06-18T10:00:00Z',
      processed_at: null,
      resolved_at: null,
      closed_at: null,
      resolution_note: 'Checked bin'
    };

    const payload = buildExceptionPrintPayload(report, 'https://example.test');
    const fields = new Map(payload.fields.map((field) => [field.label, field.value]));
    const fieldLabels = payload.fields.map((field) => field.label);
    const qrFields = new Map(payload.qrFields.map((field) => [field.label, field.value]));

    expect(payload.reportId).toBe('202606180001');
    expect(payload.qrValue).toContain('/exception?id=99');
    expect(payload.createdBy).toBe('US300');
    expect(payload.exceptionTypeLabel).toBe('Less Pick');
    expect(qrFields.get('Product')).toBe('SKU123');
    expect(qrFields.get('Picking List')).toBe('PL-1');
    expect(qrFields.get('Container')).toBe('C-1');
    expect(fields.has('Product')).toBe(false);
    expect(fields.has('Picking List')).toBe(false);
    expect(fields.has('Container')).toBe(false);
    expect(fields.has('Type')).toBe(false);
    expect(fields.has('Inv Adj')).toBe(false);
    expect(fields.has('Lead')).toBe(false);
    expect(fields.has('Resolution')).toBe(false);
    expect(fields.has('Responsibility')).toBe(false);
    expect(fieldLabels.slice(0, 2)).toEqual(['Picked Loc', 'Count By']);
    expect(fields.get('Picker')).toBe('US100');
    expect(fields.get('Packer')).toBe('');
  });

  test('uses staff names in the 4x6 print payload when available', () => {
    const report: ExceptionReportRecord = {
      ...validInput(),
      id: 100,
      status: 'Closed',
      system_location_qty: 2,
      actual_qty: 2,
      borrowed_qty: null,
      responsibility_result: 'pending',
      responsible_staff_id: null,
      mistake_report_id: null,
      created_at: '2026-06-18T10:00:00Z',
      updated_at: '2026-06-18T10:00:00Z',
      processed_at: null,
      resolved_at: null,
      closed_at: null,
      packing_rebin_operator: 'US200',
      count_by: 'US300'
    };
    const names = new Map([
      ['US100', 'Daniel Plutin'],
      ['US200', 'Andres Machado'],
      ['US300', 'Wilkens Bertrand']
    ]);

    const payload = buildExceptionPrintPayload(report, '', (staffId) => names.get(staffId) ?? staffId);
    const fields = new Map(payload.fields.map((field) => [field.label, field.value]));

    expect(payload.createdBy).toBe('Wilkens Bertrand');
    expect(fields.get('Picker')).toBe('Daniel Plutin');
    expect(fields.get('Packer')).toBe('Andres Machado');
    expect(fields.get('Count By')).toBe('Wilkens Bertrand');
  });
});

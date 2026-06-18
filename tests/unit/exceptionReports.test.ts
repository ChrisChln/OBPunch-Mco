import { describe, expect, test } from 'vitest';
import {
  buildExceptionInsertPayload,
  buildExceptionUpdatePayload,
  buildExceptionPrintPayload,
  isValidExceptionTransition,
  needsInventoryAdjustment,
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

  test('builds a normalized update payload from edited report fields', () => {
    const payload = buildExceptionUpdatePayload({
      ...validInput(),
      product_barcode: ' sku123 ',
      picking_operator: ' us100 ',
      borrowed_location: ' b02 ',
      borrowed_qty: '2',
      resolution_note: ' checked '
    });

    expect(payload?.product_barcode).toBe('SKU123');
    expect(payload?.picking_operator).toBe('US100');
    expect(payload?.borrowed_location).toBe('B02');
    expect(payload?.borrowed_qty).toBe(2);
    expect(payload?.resolution_note).toBe('checked');
  });

  test('allows only forward status transitions', () => {
    expect(isValidExceptionTransition('Open', 'Processing')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Resolved')).toBe(true);
    expect(isValidExceptionTransition('Processing', 'Pending Adjustment')).toBe(true);
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

  test('maps all key report fields into the 4x6 print payload', () => {
    const report: ExceptionReportRecord = {
      ...validInput(),
      id: 99,
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
    const qrFields = new Map(payload.qrFields.map((field) => [field.label, field.value]));

    expect(payload.reportId).toBe('99');
    expect(payload.qrValue).toContain('/exception?id=99');
    expect(payload.createdBy).toBe('US300');
    expect(qrFields.get('Product')).toBe('SKU123');
    expect(qrFields.get('Picking List')).toBe('PL-1');
    expect(qrFields.get('Container')).toBe('C-1');
    expect(fields.has('Product')).toBe(false);
    expect(fields.has('Picking List')).toBe(false);
    expect(fields.has('Container')).toBe(false);
    expect(fields.has('Inv Adj')).toBe(false);
    expect(fields.has('Lead')).toBe(false);
    expect(fields.has('Resolution')).toBe(false);
    expect(fields.has('Responsibility')).toBe(false);
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

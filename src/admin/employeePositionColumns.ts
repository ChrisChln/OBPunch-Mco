export type EmployeePositionColumnMode = 'lower' | 'cased' | 'both';

type EmployeePositionWritePayload = {
  position?: string | null;
  Position?: string | null;
};

export const probeEmployeePositionColumnMode = async (
  probe: (column: 'position' | 'Position') => Promise<boolean>
): Promise<EmployeePositionColumnMode> => {
  const lowerAvailable = await probe('position');
  const casedAvailable = await probe('Position');

  if (lowerAvailable && casedAvailable) return 'both';
  if (lowerAvailable) return 'lower';
  return 'cased';
};

export const buildEmployeePositionWritePayload = (
  mode: EmployeePositionColumnMode,
  position: string | null
): EmployeePositionWritePayload => {
  if (mode === 'both') return { position, Position: position };
  if (mode === 'lower') return { position };
  return { Position: position };
};

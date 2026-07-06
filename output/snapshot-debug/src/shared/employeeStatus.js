export const getEmployeeTerminatedAt = (employee) => {
    const value = String(employee?.terminatedAt ?? '').trim();
    return value || null;
};
const toLocalDateKey = (value) => {
    if (value == null || value === '')
        return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
export const isEmployeeTerminated = (employee, options = {}) => {
    const terminatedAt = getEmployeeTerminatedAt(employee);
    if (!terminatedAt)
        return false;
    if (!options.allowTerminationDate)
        return true;
    const terminatedDateKey = toLocalDateKey(terminatedAt);
    const referenceDateKey = toLocalDateKey(options.referenceAt);
    if (!terminatedDateKey || !referenceDateKey)
        return true;
    return referenceDateKey > terminatedDateKey;
};

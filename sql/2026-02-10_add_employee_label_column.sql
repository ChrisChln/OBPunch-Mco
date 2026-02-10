-- Add editable label field for employee management.
-- Safe to run multiple times.
ALTER TABLE public.ob_employees
ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN public.ob_employees.label IS 'Custom employee label managed in Admin > Employees.';

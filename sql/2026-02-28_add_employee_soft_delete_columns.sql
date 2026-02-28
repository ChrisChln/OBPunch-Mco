ALTER TABLE public.ob_employees
ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.ob_employees
ADD COLUMN IF NOT EXISTS terminated_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_ob_employees_active ON public.ob_employees (active);

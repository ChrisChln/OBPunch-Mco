-- Store day-level attendance marks that must survive weekly schedule template resets.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS public.ob_attendance_marks (
  id bigserial PRIMARY KEY,
  staff_id text NOT NULL,
  work_date date NOT NULL,
  mark_type text NOT NULL CHECK (mark_type IN ('absent', 'excuse', 'temporary_leave')),
  source text NULL,
  operator text NULL,
  payload jsonb NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ob_attendance_marks_staff_date_type_uidx
  ON public.ob_attendance_marks (staff_id, work_date, mark_type);

CREATE INDEX IF NOT EXISTS ob_attendance_marks_work_date_idx
  ON public.ob_attendance_marks (work_date);

CREATE INDEX IF NOT EXISTS ob_attendance_marks_staff_id_idx
  ON public.ob_attendance_marks (staff_id);

COMMENT ON TABLE public.ob_attendance_marks IS 'Persistent attendance marks by natural work date.';
COMMENT ON COLUMN public.ob_attendance_marks.mark_type IS 'absent | excuse | temporary_leave';

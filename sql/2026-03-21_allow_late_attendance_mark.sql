-- Extend attendance marks to allow durable late records.
-- Safe to run multiple times.

ALTER TABLE public.ob_attendance_marks
  DROP CONSTRAINT IF EXISTS ob_attendance_marks_mark_type_check;

ALTER TABLE public.ob_attendance_marks
  ADD CONSTRAINT ob_attendance_marks_mark_type_check
  CHECK (mark_type IN ('absent', 'excuse', 'temporary_leave', 'late'));

COMMENT ON COLUMN public.ob_attendance_marks.mark_type IS 'absent | excuse | temporary_leave | late';

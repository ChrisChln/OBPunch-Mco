create table if not exists public.volume_history (
  date date primary key,
  weekday int generated always as (extract(isodow from date)::int) stored,
  h00 int not null default 0,
  h01 int not null default 0,
  h02 int not null default 0,
  h03 int not null default 0,
  h04 int not null default 0,
  h05 int not null default 0,
  h06 int not null default 0,
  h07 int not null default 0,
  h08 int not null default 0,
  h09 int not null default 0,
  h10 int not null default 0,
  h11 int not null default 0,
  h12 int not null default 0,
  h13 int not null default 0,
  h14 int not null default 0,
  h15 int not null default 0,
  h16 int not null default 0,
  h17 int not null default 0,
  h18 int not null default 0,
  h19 int not null default 0,
  h20 int not null default 0,
  h21 int not null default 0,
  h22 int not null default 0,
  h23 int not null default 0,
  total_volume int generated always as (
    h00 + h01 + h02 + h03 + h04 + h05 + h06 + h07 + h08 + h09 + h10 + h11 +
    h12 + h13 + h14 + h15 + h16 + h17 + h18 + h19 + h20 + h21 + h22 + h23
  ) stored,
  updated_at timestamptz not null default now(),
  constraint volume_history_weekday_chk check (weekday between 1 and 7),
  constraint volume_history_h00_chk check (h00 >= 0),
  constraint volume_history_h01_chk check (h01 >= 0),
  constraint volume_history_h02_chk check (h02 >= 0),
  constraint volume_history_h03_chk check (h03 >= 0),
  constraint volume_history_h04_chk check (h04 >= 0),
  constraint volume_history_h05_chk check (h05 >= 0),
  constraint volume_history_h06_chk check (h06 >= 0),
  constraint volume_history_h07_chk check (h07 >= 0),
  constraint volume_history_h08_chk check (h08 >= 0),
  constraint volume_history_h09_chk check (h09 >= 0),
  constraint volume_history_h10_chk check (h10 >= 0),
  constraint volume_history_h11_chk check (h11 >= 0),
  constraint volume_history_h12_chk check (h12 >= 0),
  constraint volume_history_h13_chk check (h13 >= 0),
  constraint volume_history_h14_chk check (h14 >= 0),
  constraint volume_history_h15_chk check (h15 >= 0),
  constraint volume_history_h16_chk check (h16 >= 0),
  constraint volume_history_h17_chk check (h17 >= 0),
  constraint volume_history_h18_chk check (h18 >= 0),
  constraint volume_history_h19_chk check (h19 >= 0),
  constraint volume_history_h20_chk check (h20 >= 0),
  constraint volume_history_h21_chk check (h21 >= 0),
  constraint volume_history_h22_chk check (h22 >= 0),
  constraint volume_history_h23_chk check (h23 >= 0)
);

create index if not exists volume_history_weekday_date_idx
  on public.volume_history (weekday, date desc);

create or replace function public.get_forecasting_model(
  p_lookback_days int default 28
)
returns table (
  weekday int,
  hour_of_day int,
  avg_share double precision,
  stddev_share double precision,
  sample_size int,
  lookback_days int,
  lookback_start date,
  lookback_end date
)
language sql
stable
as $$
  with lookback as (
    select
      case
        when p_lookback_days is null or p_lookback_days <= 0 then null::date
        else (current_date - make_interval(days => greatest(p_lookback_days - 1, 0)))::date
      end as lookback_start,
      current_date::date as lookback_end,
      case
        when p_lookback_days is null or p_lookback_days <= 0 then null::int
        else p_lookback_days
      end as lookback_days
  ),
  eligible_days as (
    select
      vh.date,
      vh.weekday,
      vh.total_volume::numeric as total_volume,
      vh.h00,
      vh.h01,
      vh.h02,
      vh.h03,
      vh.h04,
      vh.h05,
      vh.h06,
      vh.h07,
      vh.h08,
      vh.h09,
      vh.h10,
      vh.h11,
      vh.h12,
      vh.h13,
      vh.h14,
      vh.h15,
      vh.h16,
      vh.h17,
      vh.h18,
      vh.h19,
      vh.h20,
      vh.h21,
      vh.h22,
      vh.h23
    from public.volume_history vh
    cross join lookback lb
    where (lb.lookback_start is null or vh.date >= lb.lookback_start)
      and vh.date <= lb.lookback_end
      and vh.total_volume > 0
  ),
  share_points as (
    select
      ed.weekday,
      hourly.hour_of_day,
      (hourly.cum_volume / ed.total_volume) as share_h
    from eligible_days ed
    cross join lateral (
      values
        -- Match the Excel template semantics:
        -- cutoff 08:00 means cumulative volume from 00:00-07:59,
        -- cutoff 12:00 means cumulative volume from 00:00-11:59.
        (0, 0::numeric),
        (1, (ed.h00)::numeric),
        (2, (ed.h00 + ed.h01)::numeric),
        (3, (ed.h00 + ed.h01 + ed.h02)::numeric),
        (4, (ed.h00 + ed.h01 + ed.h02 + ed.h03)::numeric),
        (5, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04)::numeric),
        (6, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05)::numeric),
        (7, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06)::numeric),
        (8, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07)::numeric),
        (9, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08)::numeric),
        (10, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09)::numeric),
        (11, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10)::numeric),
        (12, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11)::numeric),
        (13, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12)::numeric),
        (14, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13)::numeric),
        (15, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14)::numeric),
        (16, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15)::numeric),
        (17, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16)::numeric),
        (18, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17)::numeric),
        (19, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17 + ed.h18)::numeric),
        (20, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17 + ed.h18 + ed.h19)::numeric),
        (21, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17 + ed.h18 + ed.h19 + ed.h20)::numeric),
        (22, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17 + ed.h18 + ed.h19 + ed.h20 + ed.h21)::numeric),
        (23, (ed.h00 + ed.h01 + ed.h02 + ed.h03 + ed.h04 + ed.h05 + ed.h06 + ed.h07 + ed.h08 + ed.h09 + ed.h10 + ed.h11 + ed.h12 + ed.h13 + ed.h14 + ed.h15 + ed.h16 + ed.h17 + ed.h18 + ed.h19 + ed.h20 + ed.h21 + ed.h22)::numeric)
    ) as hourly(hour_of_day, cum_volume)
    where hourly.hour_of_day in (8, 9, 10, 11, 12)
  ),
  eligible_summary as (
    select min(date)::date as min_date
    from eligible_days
  )
  select
    sp.weekday,
    sp.hour_of_day,
    avg(sp.share_h)::double precision as avg_share,
    coalesce(stddev_samp(sp.share_h), 0)::double precision as stddev_share,
    count(*)::int as sample_size,
    coalesce(lb.lookback_days, count(*)::int)::int as lookback_days,
    coalesce(lb.lookback_start, es.min_date)::date as lookback_start,
    lb.lookback_end as lookback_end
  from share_points sp
  cross join lookback lb
  cross join eligible_summary es
  group by sp.weekday, sp.hour_of_day, lb.lookback_days, lb.lookback_start, lb.lookback_end, es.min_date
  order by sp.weekday, sp.hour_of_day;
$$;

create or replace view public.forecasting_model as
select *
from public.get_forecasting_model(28);

create or replace function public.calculate_volume_forecast(
  p_current_cum_volume numeric,
  p_current_hour int,
  p_weekday int,
  p_lookback_days int default 28
)
returns table (
  weekday int,
  hour_of_day int,
  current_cum_volume numeric,
  avg_share double precision,
  stddev_share double precision,
  forecast double precision,
  lower_bound double precision,
  upper_bound double precision,
  upper_unbounded boolean,
  sample_size int
)
language sql
stable
as $$
  select
    fm.weekday,
    fm.hour_of_day,
    p_current_cum_volume as current_cum_volume,
    fm.avg_share,
    fm.stddev_share,
    case
      when fm.avg_share > 0 then (p_current_cum_volume::double precision / fm.avg_share)
      else null::double precision
    end as forecast,
    case
      when (fm.avg_share + fm.stddev_share) > 0 then (p_current_cum_volume::double precision / (fm.avg_share + fm.stddev_share))
      else null::double precision
    end as lower_bound,
    case
      when (fm.avg_share - fm.stddev_share) > 0 then (p_current_cum_volume::double precision / (fm.avg_share - fm.stddev_share))
      else 'Infinity'::double precision
    end as upper_bound,
    ((fm.avg_share - fm.stddev_share) <= 0) as upper_unbounded,
    fm.sample_size
  from public.get_forecasting_model(p_lookback_days) fm
  where fm.weekday = p_weekday
    and fm.hour_of_day = p_current_hour;
$$;

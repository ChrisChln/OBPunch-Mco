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
      and coalesce(vh.last_filled_hour, 23) >= 23
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
    where hourly.hour_of_day between 1 and 23
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
    lb.lookback_end::date as lookback_end
  from share_points sp
  cross join lookback lb
  cross join eligible_summary es
  group by sp.weekday, sp.hour_of_day, lb.lookback_days, lb.lookback_start, lb.lookback_end, es.min_date
  order by sp.weekday, sp.hour_of_day;
$$;

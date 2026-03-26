import { useEffect, useRef, useCallback } from 'react';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type ScheduleRealtimeEvent = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  staffId: string;
  date: string;
  timestamp: number;
};

type ScheduleRealtimeOptions = {
  supabase: SupabaseClient | null;
  scheduleTableName: string;
  onScheduleChange?: (event: ScheduleRealtimeEvent) => void;
  enabled?: boolean;
};

/**
 * 监听排班表(ob_schedules)的实时变化
 * 用于实现不同设备/页面的自动同步
 */
export const useScheduleRealtime = (options: ScheduleRealtimeOptions) => {
  const { supabase, scheduleTableName, onScheduleChange, enabled = true } = options;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscriptionCountRef = useRef(0);

  const subscribe = useCallback(() => {
    if (!supabase || !enabled || !onScheduleChange) return;
    if (channelRef.current) return; // Already subscribed

    subscriptionCountRef.current += 1;
    const subscriptionId = subscriptionCountRef.current;

    const channel = supabase
      .channel(`schedule-realtime-${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events: INSERT, UPDATE, DELETE
          schema: 'public',
          table: scheduleTableName
        },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row) return;

          const staffId = String(row.staff_id ?? '').trim();
          const date = String(row.date ?? '').trim();
          if (!staffId || !date) return;

          onScheduleChange({
            type: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            staffId,
            date,
            timestamp: Date.now()
          });
        }
      )
      .subscribe((status) => {
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          channelRef.current = null;
          // Retry after delay
          const timer = setTimeout(() => subscribe(), 5000);
          return () => clearTimeout(timer);
        }
      });

    channelRef.current = channel;
  }, [supabase, scheduleTableName, onScheduleChange, enabled]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, [supabase]);

  useEffect(() => {
    if (enabled) {
      subscribe();
    } else {
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [subscribe, unsubscribe, enabled]);

  return {
    isSubscribed: !!channelRef.current,
    subscribe,
    unsubscribe
  };
};

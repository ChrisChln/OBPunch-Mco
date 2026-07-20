import { useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type EmployeeRealtimeEvent = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  staffId: string;
  timestamp: number;
};

type EmployeeRealtimeOptions = {
  supabase: SupabaseClient | null;
  employeeTableName: string;
  onEmployeeChange?: (event: EmployeeRealtimeEvent) => void;
  enabled?: boolean;
};

export const shouldEnableEmployeeRealtime = (page: string, departedEmployeesOpen: boolean) =>
  departedEmployeesOpen || page === 'employees' || page === 'accounts' || page === 'employee_upload';

export const useEmployeeRealtime = (options: EmployeeRealtimeOptions) => {
  const { supabase, employeeTableName, onEmployeeChange, enabled = true } = options;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscriptionCountRef = useRef(0);

  const subscribe = useCallback(() => {
    if (!supabase || !enabled || !onEmployeeChange) return;
    if (channelRef.current) return;

    subscriptionCountRef.current += 1;
    const subscriptionId = subscriptionCountRef.current;

    const channel = supabase
      .channel(`employee-realtime-${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: employeeTableName
        },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row) return;

          const staffId = String(row.staff_id ?? '').trim();
          if (!staffId) return;

          onEmployeeChange({
            type: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            staffId,
            timestamp: Date.now()
          });
        }
      )
      .subscribe((status) => {
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          channelRef.current = null;
          const timer = window.setTimeout(() => subscribe(), 5000);
          return () => window.clearTimeout(timer);
        }
      });

    channelRef.current = channel;
  }, [supabase, enabled, onEmployeeChange, employeeTableName]);

  const unsubscribe = useCallback(() => {
    if (!channelRef.current) return;
    supabase?.removeChannel(channelRef.current);
    channelRef.current = null;
  }, [supabase]);

  useEffect(() => {
    if (enabled) subscribe();
    else unsubscribe();

    return () => {
      unsubscribe();
    };
  }, [enabled, subscribe, unsubscribe]);

  return {
    isSubscribed: !!channelRef.current,
    subscribe,
    unsubscribe
  };
};

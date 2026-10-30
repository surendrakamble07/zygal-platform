import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Device } from './device-types'

export function useDevicesForSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['devices', 'by-site', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devices')
        .select(
          'id, site_id, sim_name, sim_number, link_ip, link_mac_id, vault_tam, cash_counter_tam, main_door_tam, ngl_main_door_tam, device_status, notes, sim_photo_path',
        )
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .order('device_status')
      if (error) throw error
      return (data ?? []) as Device[]
    },
  })
}

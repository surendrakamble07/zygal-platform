export interface Device {
  id: string
  site_id: string
  sim_name: string | null
  sim_number: string | null
  link_ip: string | null
  link_mac_id: string | null
  vault_tam: string | null
  cash_counter_tam: string | null
  main_door_tam: string | null
  ngl_main_door_tam: string | null
  device_status: 'Active' | 'Replaced'
  notes: string | null
}

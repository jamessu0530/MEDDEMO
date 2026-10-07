import type { LegMode } from "@/api/route"
import type { CityVehicles } from "@/components/rides/vehicles/types"
import { changhua } from "@/components/rides/vehicles/changhua"
import { hsinchu } from "@/components/rides/vehicles/hsinchu"
import { newTaipei } from "@/components/rides/vehicles/new-taipei"
import { taichung } from "@/components/rides/vehicles/taichung"
import { taipei } from "@/components/rides/vehicles/taipei"
import type { RideCity } from "@/lib/rides"

/** 每個縣市的四種座騎。還沒畫的縣市不在這裡（Task 6 全部畫完後改成完整的 Record） */
export const VEHICLES: Partial<Record<RideCity, CityVehicles>> = {
  台北市: taipei,
  新北市: newTaipei,
  新竹市: hsinchu,
  台中市: taichung,
  彰化縣: changhua,
}

export function vehicleFor(city: RideCity, mode: LegMode) {
  return VEHICLES[city]?.[mode]
}

import type { CityVehicles } from "@/components/rides/vehicles/types"
import { changhua } from "@/components/rides/vehicles/changhua"
import { hsinchu } from "@/components/rides/vehicles/hsinchu"
import { kaohsiung } from "@/components/rides/vehicles/kaohsiung"
import { newTaipei } from "@/components/rides/vehicles/new-taipei"
import { taichung } from "@/components/rides/vehicles/taichung"
import { tainan } from "@/components/rides/vehicles/tainan"
import { taipei } from "@/components/rides/vehicles/taipei"
import type { RideCity } from "@/lib/rides"

/**
 * 七個縣市各四種座騎，28 種都在。用的地方直接查表（VEHICLES[city][mode]）：
 * react-hooks 的 lint 把函式回傳的元件當成每次 render 新做的，所以不包成函式。
 */
export const VEHICLES: Record<RideCity, CityVehicles> = {
  台北市: taipei,
  新北市: newTaipei,
  新竹市: hsinchu,
  台中市: taichung,
  彰化縣: changhua,
  台南市: tainan,
  高雄市: kaohsiung,
}

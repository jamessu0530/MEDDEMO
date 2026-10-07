import type { ComponentType, ReactNode } from "react"

import type { LegMode } from "@/api/route"

/** 熊熊滾放在座騎的哪裡：在座騎畫布（0 0 300 200）上的左上角與邊長；熊自己的畫布是 240×240 */
export type BearAt = { x: number; y: number; size: number }

/** 一種座騎。自己決定圖層順序（擋住熊的腳的部分畫在 bear 之後），在要放熊的地方呼叫 bear(位置) */
export type VehicleProps = { bear: (at: BearAt) => ReactNode }

export type CityVehicles = Record<LegMode, ComponentType<VehicleProps>>

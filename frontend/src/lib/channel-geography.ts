import geography from "@/data/taiwan-districts.json"
import type { Channel } from "@/api/channels"

export const GEOGRAPHY_SOURCE = geography

export function locationKey(name: string): string {
  return name.replace(/[\s・·]/g, "").replaceAll("台", "臺")
}

export function placeDirectory(channels: Channel[], query = "") {
  const shared = channels.filter((channel) => channel.kind === "place" && channel.region_id === null)
  const byName = new Map<string, Channel[]>()
  for (const channel of shared) {
    const key = locationKey(channel.name)
    byName.set(key, [...(byName.get(key) ?? []), channel])
  }
  const known = new Set<string>()
  const needle = locationKey(query)
  const cities = geography.cities.map((city) => {
    const districts = city.districts.map((district) => {
      const key = locationKey(city.name + district.name)
      known.add(key)
      return { ...district, channels: byName.get(key) ?? [] }
    })
    return {
      ...city,
      total: districts.length,
      unread: districts.reduce((sum, district) => sum + district.channels.reduce((n, channel) => n + channel.unread, 0), 0),
      districts: districts.filter((district) => !needle || locationKey(city.name + district.name).includes(needle)),
    }
  }).filter((city) => city.districts.length > 0)
  return {
    cities,
    other: shared.filter((channel) => !known.has(locationKey(channel.name)) && locationKey(channel.name).includes(needle)),
  }
}

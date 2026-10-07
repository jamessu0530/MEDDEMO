import { renderToStaticMarkup } from "react-dom/server"

import { Ride } from "@/components/rides/ride"
import { RIDE_CITIES, SPECIALTY } from "@/lib/rides"
import { LEG_MODES, TRAVEL_MODE_LABEL } from "@/lib/travel-mode"

/**
 * 座騎的定案表（docs/superpowers/specs/assets/2026-10-07-ride-sheet.html）：七個縣市 × 四種交通方式，
 * 每格一大一小（180 與首頁路線上的 96），最後一列示範往左走與停住的樣子。由 scripts/ride-sheet.mjs 產生，
 * css 是 mascot.css、ride.css 與各縣市的 css 接起來的內容。
 */
export function renderRideSheet(css: string): string {
  const body = renderToStaticMarkup(
    <main>
      <h1>熊熊滾的座騎</h1>
      <p>七個縣市 × 四種交通方式。每格左邊是 180px，右邊是首頁路線上的 96px。系統設定「減少動態效果」時全部停住。</p>
      <table>
        <thead>
          <tr>
            <th />
            {LEG_MODES.map((mode) => (
              <th key={mode}>{TRAVEL_MODE_LABEL[mode]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RIDE_CITIES.map((city) => (
            <tr key={city}>
              <th>
                {city}
                <small>{SPECIALTY[city]}</small>
              </th>
              {LEG_MODES.map((mode) => (
                <td key={mode}>
                  <Ride city={city} mode={mode} size={180} />
                  <Ride city={city} mode={mode} size={96} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th>
              其他
              <small>往左走、停住、沒有座騎</small>
            </th>
            <td><Ride city="新竹市" mode="scooter" size={180} flipped /></td>
            <td><Ride city="新竹市" mode="walk" size={180} still /></td>
            <td><Ride city="桃園市" mode="drive" size={180} /></td>
            <td />
          </tr>
        </tbody>
      </table>
    </main>
  )
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>熊熊滾的座騎</title>
<style>
body { margin: 0; background: #F6F5F9; color: #1A1626; font-family: system-ui, "PingFang TC", sans-serif; }
main { padding: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
p { margin: 0 0 16px; color: #6E6A78; font-size: 14px; }
table { border-collapse: separate; border-spacing: 8px; }
th { font-size: 14px; text-align: left; vertical-align: middle; }
th small { display: block; font-weight: 400; color: #6E6A78; }
td { background: #fff; border-radius: 16px; padding: 8px; vertical-align: bottom; }
td .ride { display: inline-block; vertical-align: bottom; }
${css}
</style>
</head>
<body>${body}</body>
</html>
`
}

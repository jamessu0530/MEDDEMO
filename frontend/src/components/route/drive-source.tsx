/** 車程從哪裡來：Google 算的標「Google Maps」（Google 的使用條款，不翻譯），直線估算的寫「（估計）」 */
export function DriveSource({ estimated }: { estimated: boolean }) {
  return estimated ? <span>（估計）</span> : <span className="font-[Roboto,sans-serif]"> · Google Maps</span>
}

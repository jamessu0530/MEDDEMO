/** 服裝跟著 .mascot-body 一起動；帽子、圍巾與披風都沿用沒有手的輪廓。 */
export function MascotCostume({ outfit }: { outfit: string }) {
  if (outfit === "scarf" || outfit === "taichung" || outfit === "tainan") {
    const milk = outfit === "taichung"
    const fish = outfit === "tainan"
    const fill = milk ? "#D8B88F" : fish ? "#83BBC7" : "#7BC9E0"
    return <g data-costume={outfit}>
      <path d="M56 154 Q120 175 184 154 V170 Q120 190 56 170 Z" fill={fill} />
      <path d="M139 173 L162 174 L170 204 L145 204 Z" fill={fill} />
      {milk && <g fill="#674C43">{[78, 99, 120, 141, 162].map((x) => <circle key={x} cx={x} cy="172" r="4" />)}<circle cx="156" cy="191" r="4" /></g>}
      {fish && <g><path d="M103 169 Q120 152 136 169 Q120 184 103 169 L94 161 V178 Z" fill="#E3F4F2" /><circle cx="130" cy="168" r="2.3" fill="#245365" /></g>}
      {!milk && !fish && <path d="M146 195 H168" stroke="#CFF1FA" strokeWidth="5" />}
    </g>
  }
  if (outfit === "beret") return <g data-costume={outfit}><path d="M77 61 Q71 36 98 30 Q130 16 155 35 Q163 45 159 61 Z" fill="#F39B65" /><path d="M78 58 Q120 52 159 58 V66 H78 Z" fill="#C87348" /><path d="M121 31 V23" stroke="#C87348" strokeWidth="6" strokeLinecap="round" /></g>
  if (outfit === "taipei") return <g data-costume={outfit}><path d="M80 62 Q79 40 101 35 Q110 31 120 24 Q130 31 139 35 Q161 40 160 62 Z" fill="#FFE5C0" /><g fill="none" stroke="#D7A36A" strokeWidth="3" strokeLinecap="round"><path d="M120 27 V53 M114 33 Q98 38 97 53 M126 33 Q142 38 143 53" /></g><ellipse cx="120" cy="63" rx="44" ry="7" fill="#C58D56" /></g>
  if (outfit === "hsinchu") return <g data-costume={outfit}><path d="M82 56 H158 V65 H82 Z" fill="#B78255" /><circle cx="94" cy="47" r="16" fill="#D5B791" /><circle cx="120" cy="36" r="18" fill="#E4CAA7" /><circle cx="146" cy="47" r="16" fill="#D5B791" /><g fill="#B89570"><circle cx="116" cy="30" r="2" /><circle cx="126" cy="40" r="2" /><circle cx="91" cy="42" r="2" /><circle cx="149" cy="50" r="2" /></g></g>
  if (outfit === "changhua") return <g data-costume={outfit}><path d="M77 61 Q82 25 120 28 Q158 25 163 61 Z" fill="#F7DBE7" /><path d="M92 55 Q120 36 148 55" fill="none" stroke="#E3A4BA" strokeWidth="10" strokeLinecap="round" /><ellipse cx="120" cy="62" rx="47" ry="7" fill="#B97568" /><path d="M106 41 Q120 35 134 41" fill="none" stroke="#ADCA84" strokeWidth="5" strokeLinecap="round" /></g>
  if (outfit === "kaohsiung") return <g data-costume={outfit}><path d="M79 36 Q115 59 157 28 Q153 64 120 68 Q92 68 79 36 Z" fill="#FFE070" /><path d="M85 40 Q113 62 153 33" fill="none" stroke="#E6B53E" strokeWidth="4" strokeLinecap="round" /><path d="M151 29 L158 23" stroke="#84694B" strokeWidth="7" strokeLinecap="round" /></g>
  if (outfit === "new-taipei") return <g data-costume={outfit}><path d="M55 153 Q120 177 185 153 L176 170 Q120 190 64 170 Z" fill="#F3A880" /><circle cx="120" cy="172" r="7" fill="#FFD886" /><path d="M116 165 H124 V180 H116 Z" fill="#CC725B" /></g>
  return null
}

export function MascotCape({ outfit }: { outfit: string }) {
  if (outfit !== "new-taipei") return null
  return <path data-cape="new-taipei" d="M68 149 Q120 133 172 149 L198 207 Q160 225 120 209 Q80 225 42 207 Z" fill="#E3846D" />
}

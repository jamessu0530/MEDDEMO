/** 服裝跟著 .mascot-body 一起動；手持款加一隻同色小熊掌握住道具。 */
export function MascotCostume({ outfit, base, light }: { outfit: string; base: string; light: string }) {
  if (outfit === "nurse") return <g data-costume={outfit}>
    <path d="M79 39 Q120 27 161 39 L153 64 H87 Z" fill="#FFF9FC" stroke="#DECDEB" strokeWidth="3" strokeLinejoin="round" />
    <path d="M85 60 H155 L153 72 H87 Z" fill="#FFF9FC" />
    <path d="M87 65 H153" stroke="#EE8FA8" strokeWidth="4" />
    <path d="M116 39 H124 V46 H131 V54 H124 V61 H116 V54 H109 V46 H116 Z" fill="#DF6688" />
  </g>
  if (outfit === "pill") return <g data-costume={outfit} transform="rotate(-20 120 43)">
    <path d="M120 28 H103 A15 15 0 0 0 103 58 H120 Z" fill="#F17F99" />
    <path d="M120 28 H137 A15 15 0 0 1 137 58 H120 Z" fill="#FFF0CA" />
    <path d="M120 29 V57" stroke="#D8A17F" strokeWidth="3" />
    <path d="M100 35 Q96 36 95 40 M128 35 H137" fill="none" stroke="#FFF9F2" strokeWidth="4" strokeLinecap="round" />
  </g>
  if (outfit === "tie") return <g data-costume={outfit}>
    <path d="M94 153 L120 160 L108 177 Z M146 153 L120 160 L132 177 Z" fill="#FFF9FC" />
    <path d="M111 160 H129 L125 172 H115 Z" fill="#3C679D" />
    <path d="M115 172 H125 L132 197 L120 208 L108 197 Z" fill="#548BC5" />
    <path d="M114 184 L128 191 M111 195 L122 201" stroke="#A6D5ED" strokeWidth="4" />
  </g>
  if (outfit === "syringe") return <g data-costume={outfit}>
    <g transform="rotate(24 185 159)">
      <path d="M185 106 V124" stroke="#819AAE" strokeWidth="3" strokeLinecap="round" />
      <path d="M180 122 H190 V134 H180 Z" fill="#65BEBE" />
      <rect x="174" y="132" width="22" height="45" rx="5" fill="#F2FCFD" stroke="#8ACBD3" strokeWidth="3" />
      <path d="M178 155 H192 V171 Q192 173 189 173 H181 Q178 173 178 170 Z" fill="#92DDD8" />
      <path d="M188 141 H194 M188 149 H194 M188 157 H194" stroke="#4E9AA8" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M169 177 H201 M185 180 V192 M176 194 H194" stroke="#65BEBE" strokeWidth="6" strokeLinecap="round" />
    </g>
    <HoldingPaw x={178} y={165} base={base} light={light} />
  </g>
  if (outfit === "briefcase") return <g data-costume={outfit}>
    <rect x="174" y="151" width="23" height="25" rx="7" fill="none" stroke="#8E5D49" strokeWidth="6" />
    <rect x="154" y="167" width="61" height="42" rx="7" fill="#A97355" />
    <path d="M154 176 Q184 190 215 176 V172 Q215 167 208 167 H161 Q154 167 154 172 Z" fill="#CA956E" />
    <path d="M164 188 V201 M205 188 V201" stroke="#BF8965" strokeWidth="3" strokeLinecap="round" />
    <rect x="180" y="181" width="10" height="10" rx="2" fill="#FFE0A0" />
    <HoldingPaw x={181} y={154} base={base} light={light} />
  </g>
  if (outfit === "wrench") return <g data-costume={outfit}>
    <g transform="rotate(20 186 157)">
      <path d="M175 115 Q167 120 169 132 Q170 140 179 144 L179 192 A8 8 0 0 0 195 192 L195 144 Q207 138 205 125 Q204 118 198 115 V129 L187 135 L176 129 Z" fill="#A7BCCB" />
      <path d="M184 148 V181" stroke="#DCE8F0" strokeWidth="4" strokeLinecap="round" />
      <circle cx="187" cy="192" r="3.5" fill="#6D879B" />
      <path d="M174 132 L187 139 L200 132" fill="none" stroke="#819CAD" strokeWidth="3" strokeLinecap="round" />
    </g>
    <HoldingPaw x={184} y={164} base={base} light={light} />
  </g>
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

function HoldingPaw({ x, y, base, light }: { x: number; y: number; base: string; light: string }) {
  return <g data-costume-paw="" transform={`translate(${x} ${y})`}>
    <ellipse rx="14" ry="11" fill={base} />
    <path d="M3 -4 Q8 -5 9 0" fill="none" stroke={light} strokeWidth="3" strokeLinecap="round" />
  </g>
}

export function MascotCape({ outfit }: { outfit: string }) {
  if (outfit !== "new-taipei") return null
  return <path data-cape="new-taipei" d="M68 149 Q120 133 172 149 L198 207 Q160 225 120 209 Q80 225 42 207 Z" fill="#E3846D" />
}

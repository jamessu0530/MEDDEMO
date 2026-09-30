import { BLEED, type InkEffect } from "@/ink/effects"

/*
 * 四種油墨效果的 fragment shader。形狀全是雜訊算出來的，沒有圖檔。
 *
 * 共用的約定：
 * - p 是畫布上的位置（CSS px，左上角是原點）。
 * - uT 是進度：0 沒有墨，0.5 整個畫面都是墨（換頁的那一刻），1 墨都退掉了。
 *   前半 0～0.47 蓋上來，0.47～0.53 停住，後半 0.53～1 退掉。
 * - 回傳 vec4(顏色, 不透明度)。0.5 時每個像素的不透明度都要是 1，不然會看到底下的頁面跳一下；
 *   0 和 1 時都要是 0，不然墨會突然出現或突然消失。改係數之後要在瀏覽器裡讀像素確認。
 * - uColA → uColB 是墨從剛落下到放久的顏色，uWashA → uWashB 是變薄的地方的顏色（ink/effects.ts 的 inkColors）。
 */

const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uDpr;
uniform float uT;
uniform vec2 uO;
uniform float uMaxD;
uniform vec2 uSeed;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uWashA;
uniform vec3 uWashB;
uniform float uLead;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2(1., 0.)), u.x), mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= .5;
  }
  return s;
}
// 格子裡的一顆墨點：回傳半徑，c 是圓心。大部分很小，少數大顆
float cellDot(vec2 p, float g, float salt, out vec2 c) {
  vec2 id = floor(p / g);
  float rnd = hash21(id * 1.7 + salt + 3.1);
  float r = g * .42 * pow(rnd, 2.5);
  c = (id + .5 + (hash22(id + salt) - .5) * (1. - 2. * r / g)) * g;
  return r;
}
`

const TAIL = `
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec4 c = ink(p);
  // 一點點顆粒，墨才不會像純色的色塊
  float grain = hash21(floor(p * uDpr) + uSeed * 91.) - .5;
  vec3 rgb = clamp(c.rgb + grain * .03, 0., 1.);
  gl_FragColor = vec4(rgb * c.a, c.a);
}
`

const glsl = (value: number) => (Number.isInteger(value) ? `${value}.` : `${value}`)

/*
 * 墨暈：從按的位置往外滲。前緣在 uLead（ink/effects.ts 的 bleedLead 給的），後緣在 uLead - B，中間是墨。
 * f、f2 是被雜訊推歪的距離：f 決定前緣，f2 決定後緣，兩個用不同的雜訊，退掉的形狀才不會跟滲出去的一樣。
 * f 最多被推 .16×.5 + .22×.5 + .05×.5 = leadWobble，f2 最多 .12×.5 + .22×.5 + .07×.5 = trailWobble；
 * 起點附近 grow 是 0，放射的紋路（fing）不算，f2 最多只被推 .22×.5 + .07×.5 = trailWobbleAtOrigin。
 */
const BLEED_FRAG = `
const float B = ${glsl(BLEED.band)};
vec4 ink(vec2 p) {
  vec2 q = p - uO;
  float l = length(q), d = l / uMaxD;
  float fing = vnoise(q / (l + 1e-4) * 2.6 + uSeed * 9.) - .5;
  float n1 = fbm(p * .0065 + uSeed * 7.) - .5;
  float n2 = fbm(p * .045 + uSeed * 3.) - .5;
  float m = fbm(p * .009 + uSeed * 13. + 5.) - .5;
  float grow = smoothstep(0., .25, d);
  float f = d + (fing * .16 + n1 * .22) * grow + n2 * .05;
  float f2 = d + fing * .12 * grow + m * .22 + n2 * .07;
  float lead = uLead, trail = uLead - B, w = 1.5 / uMaxD;
  float a = (1. - smoothstep(lead - w, lead, f)) * smoothstep(trail - w, trail, f2);
  // 後緣淡成一圈水痕
  float thin = 1. - smoothstep(trail, trail + ${glsl(BLEED.thin)}, f2);
  float k = smoothstep(.10, .62, clamp((lead - f) / .7, 0., 1.));
  vec3 col = mix(uColA, uColB, k), wash = mix(uWashA, uWashB, k);
  col = mix(col, wash, smoothstep(.5, .85, fbm(p * .014 + uSeed * 21.)) * .28);
  col *= 1. - .22 * smoothstep(lead - .045, lead, f);
  col = mix(col, wash, thin * .8);
  float alpha = a * (1. - thin * .5);
  // 飛在前緣前面的墨點，大的一層、細的一層
  vec2 c;
  float r = cellDot(p, 24., uSeed.x * 50., c);
  float dc = length(c - uO) / uMaxD, h = hash21(c * .37 + 1.3);
  float on = smoothstep(0., .03, lead + ${glsl(BLEED.dropsAhead)} * h - dc) * (1. - smoothstep(0., .04, trail - .10 * h - dc)) * step(.45, h);
  float dots = (1. - smoothstep(r * on - 1., r * on, length(p - c))) * step(.01, on);
  r = cellDot(p, 9., uSeed.y * 50. + 7., c);
  dc = length(c - uO) / uMaxD;
  h = hash21(c * .53 + 2.1);
  on = smoothstep(0., .02, lead + .07 * h - dc) * (1. - smoothstep(0., .03, trail - .06 * h - dc)) * step(.6, h);
  dots = max(dots, (1. - smoothstep(r * on - 1., r * on, length(p - c))) * step(.01, on));
  vec3 dcol = mix(uColA, uColB, smoothstep(.10, .62, clamp((lead - d) / .7, 0., 1.)));
  col = mix(dcol, col, step(.5, a));
  return vec4(col, max(alpha, dots));
}
`

/*
 * 噴漆：噴頭來回六趟蓋滿，邊緣是一顆一顆的漆霧；蓋滿後整片漆往下流走，留下幾條慢一點的漆痕。
 * D 是這個位置被噴到多少，跟每個像素自己的門檻 th 比，超過才有漆，所以邊緣是顆粒不是漸層。
 */
const SPRAY_FRAG = `
vec4 ink(vec2 p) {
  float W = uRes.x, H = uRes.y, Hr = H / 6., R = Hr * 1.12;
  float c = clamp(uT / .47, 0., 1.);
  float sT = uT / .47 / .9 * 6.15, s = min(sT, 6.15);
  float D = 0.;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = mix(p.x, W - p.x, mod(fi, 2.));
    float an = mix(-R * 1.3, W + R * 1.3, clamp(s - fi, 0., 1.));
    float yc = (fi + .5) * Hr + sin(p.x * .011 + fi * 1.7 + uSeed.x * 6.) * Hr * .10 + (a / W - .5) * Hr * .18;
    float dens = (1. - smoothstep(R * .55, R * 1.25, length(vec2(max(a - an, 0.), p.y - yc)))) * step(fi, s);
    D = 1. - (1. - D) * (1. - dens);
  }
  // 最後補一層霧，把六趟之間漏掉的小洞填滿
  D = max(D, smoothstep(.9, 1., c));
  float th = mix(hash21(floor(p * 1.6) + uSeed * 40.), vnoise(p * .5 + uSeed * 9.), .4);
  float a = step(th * .98 + .004, D);
  vec2 cc;
  float r = cellDot(p, 11., uSeed.x * 60., cc);
  a = max(a, (1. - smoothstep(r - 1., r, length(p - cc))) * step(hash21(cc * .71 + 4.4) * .75 + .06, D));
  // 流走：edge 以上的漆已經流掉，lag 讓某幾條慢一點
  float rv = pow(clamp((uT - .53) / .47, 0., 1.), 1.7);
  float lag = pow(vnoise(vec2(p.x * .16, 3.7 + uSeed.x * 20.)), 3.) * .35 + vnoise(vec2(p.x * .03, uSeed.y * 20.)) * .22;
  float edge = rv * H * 1.62 - lag * H;
  float keep = mix(1., smoothstep(edge - 1., edge + .5, p.y), step(.0001, rv));
  float k = smoothstep(.8, 4.5, sT - p.y / Hr - .5 + (fbm(p * .009 + uSeed * 15.) - .5) * 2.);
  vec3 col = mix(uColA, uColB, k), wash = mix(uWashA, uWashB, k);
  col = mix(wash, col, smoothstep(.15, .85, D));
  col *= .94 + .12 * fbm(p * .02 + uSeed * 3.);
  col = mix(col, wash, (1. - smoothstep(0., 12., p.y - edge)) * .55 * step(.0001, rv));
  return vec4(col, a * keep);
}
`

/*
 * 潑墨：按的位置先炸一團，另外六團接著落下，帶放射的墨刺和飛濺的墨點；蓋滿後縮成一顆顆墨珠消失。
 * 第一團最後會漲到比畫面還大（flood），保證蓋得滿。
 */
const SPLAT_FRAG = `
vec4 ink(vec2 p) {
  float W = uRes.x, H = uRes.y;
  float c = clamp(uT / .47, 0., 1.);
  vec2 cc;
  float r = cellDot(p, 14., uSeed.x * 70., cc);
  float blob = 1. + (fbm(p * .018 + uSeed * 5.) - .5) * .5;
  float flood = smoothstep(.58, 1., c);
  float inside = 0., near = 0.;
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    vec2 h = hash22(vec2(fk * 5.3 + 1., 2.7) + uSeed * 31.);
    // 後面六團落在 2×3 的格子裡，順序打散，才不會看起來是一排一排落下
    float j = k == 1 ? 3. : k == 2 ? 0. : k == 3 ? 5. : k == 4 ? 1. : k == 5 ? 4. : 2.;
    vec2 ck = vec2((mod(j, 2.) * .5 + .12 + .26 * h.x) * W, (floor(j * .5) / 3. + .06 + .2 * h.y) * H);
    float g = clamp((c - fk * .075) / .22, 0., 1.);
    float grow = 1. - pow(1. - g, 3.);
    float Rk = (60. + 55. * h.x) * grow * (1. + 1.4 * flood);
    if (k == 0) {
      ck = uO;
      Rk = uMaxD * (.22 * grow + 1.36 * flood);
    }
    Rk = max(Rk, .001);
    vec2 q = p - ck;
    float l = length(q);
    float rr = l / (Rk * blob);
    float an = vnoise(q / (l + 1e-4) * 9. + fk * 13.7 + uSeed * 11.);
    float core = 1. - smoothstep(1. - 2. / Rk, 1., rr);
    // 墨刺：離中心越遠門檻越高，所以越往外越細
    float thr = mix(.35, .62, smoothstep(1., 1.15, rr)) + .4 * smoothstep(1.15, 2.6, rr);
    float arm = smoothstep(thr, thr + .03, an) * step(rr, 2.6);
    inside = max(inside, max(core, arm) * step(.001, g));
    near = max(near, step(length(cc - ck) / Rk, 3.) * step(.35, grow));
  }
  float drop = (1. - smoothstep(r - 1., r, length(p - cc))) * near * step(.4, hash21(cc * .29 + 8.8));
  // 退掉：gf 低的地方先破洞，洞的邊緣縮成墨珠
  float rv = mix(-.15, 1.2, clamp((uT - .53) / .47, 0., 1.));
  float gf = fbm(p * .011 + uSeed * 19.) * .75 + length(p - uO) / uMaxD * .35;
  float solid = smoothstep(rv + .10, rv + .112, gf);
  vec2 id = floor(p / 16.);
  float rb = 16. * (.18 + .27 * hash21(id * 1.3 + 5.));
  vec2 cb = (id + .5 + (hash22(id + uSeed.y * 70.) - .5) * (1. - 2. * rb / 16.)) * 16.;
  float sc = smoothstep(rv - .09, rv + .10, fbm(cb * .011 + uSeed * 19.) * .75 + length(cb - uO) / uMaxD * .35);
  float bead = (1. - smoothstep(rb * sc - 1., rb * sc, length(p - cb))) * step(.02, sc);
  float k = smoothstep(.28, .62, uT + (fbm(p * .008 + 3.) - .5) * .25);
  vec3 col = mix(uColA, uColB, k), wash = mix(uWashA, uWashB, k);
  col = mix(col, wash, (1. - solid) * .6 + smoothstep(.5, .85, fbm(p * .02 + uSeed * 2.)) * .18);
  return vec4(col, max(inside, drop) * max(solid, bead));
}
`

/*
 * 刷痕：五道刷子左右交錯刷過去，前後緣都是乾筆的毛邊，刷痕裡有淡色的筆觸。
 * 每道刷子的前緣 lead、後緣 trail 沿著刷的方向走；b1、b3 是刷毛長短不齊（沿刷的方向拉長的雜訊）。
 */
const BRUSH_FRAG = `
vec4 ink(vec2 p) {
  float W = uRes.x, H = uRes.y, Hb = H / 5.;
  float alpha = 0., tone = 0., rowK = 0.;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = mix(p.x, W - p.x, mod(fi, 2.));
    float yw = (vnoise(vec2(a * .012, fi * 5.1 + uSeed.x * 9.)) - .5) * 14.;
    float y0 = fi * Hb - Hb * .14 + yw, y1 = (fi + 1.) * Hb + Hb * .14 + yw;
    float inRow = smoothstep(y0 - 1., y0, p.y) * (1. - smoothstep(y1, y1 + 1., p.y));
    float v = (p.y - y0) / (y1 - y0);
    float b1 = vnoise(vec2(a * .0045 + fi * 3., v * 34. + uSeed.y * 30.));
    float b2 = vnoise(vec2(a * .02, v * 90. + fi * 11.));
    float b3 = vnoise(vec2(a * .0045 + fi * 3. + 40., v * 34. + uSeed.y * 30. + 9.));
    float ti = fi * .035;
    float lp = 1. - pow(1. - clamp((uT - ti) / .33, 0., 1.), 2.2);
    float tp = pow(clamp((uT - .53 - ti) / .33, 0., 1.), 1.6);
    float lead = mix(-100., W + 100., lp), trail = mix(-100., W + 100., tp);
    float e1 = a + (b1 - .5) * 150. + (b2 - .5) * 40.;
    float e2 = a + (b3 - .5) * 150. + (b2 - .5) * 40.;
    float on = (1. - smoothstep(lead - 1.5, lead, e1)) * smoothstep(trail - 1.5, trail, e2) * inRow;
    if (on >= alpha && on > 0.) {
      tone = smoothstep(.5, .85, b1) * .45 + smoothstep(.62, .9, b2) * .25 + smoothstep(lead - 110., lead, e1) * .3;
      rowK = fi;
    }
    alpha = max(alpha, on);
  }
  float k = smoothstep(.2, .6, uT - rowK * .02);
  vec3 col = mix(uColA, uColB, k), wash = mix(uWashA, uWashB, k);
  col = mix(col, wash, clamp(tone, 0., 1.) * .6);
  return vec4(col, alpha);
}
`

const BODY: Record<InkEffect, string> = { bleed: BLEED_FRAG, spray: SPRAY_FRAG, splat: SPLAT_FRAG, brush: BRUSH_FRAG }

export const VERTEX_SHADER = "attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }"

export function fragmentShader(effect: InkEffect) {
  return HEAD + BODY[effect] + TAIL
}

/** fragment shader 用到的 uniform，ink/renderer.ts 照這份去找位置 */
export const UNIFORMS = ["uRes", "uDpr", "uT", "uO", "uMaxD", "uSeed", "uColA", "uColB", "uWashA", "uWashB", "uLead"] as const

/**
 * 引导页插画 —— 平台中性(不引用任何平台专有令牌)。
 *
 * 颜色全部由调用方以十六进制传入:iOS 传单色墨(iosAccent),Android 传 M3 primary。
 * 这样同一套 SVG 在两端各自着色,符合「shared component + 平台着色」的约定。
 */
import React from 'react';
import Svg, { G, Path, Rect, Circle, Line } from 'react-native-svg';

/** UniClip 品牌标(复用 assets/icon.svg 的原始路径,potrace 负缩放变换) */
export function BrandMark({ color, size = 64 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <G transform="translate(0, 512) scale(0.1, -0.1)" fill={color}>
        <Path d="M3180 4554 c-360 -42 -704 -193 -983 -432 -356 -305 -596 -786 -601 -1207 l-1 -120 168 -3 167 -2 0 83 c0 381 226 800 569 1057 255 192 558 294 871 293 801 -1 1447 -684 1407 -1488 -7 -141 -24 -236 -68 -371 -175 -547 -686 -946 -1256 -981 l-103 -6 0 -169 0 -168 48 0 c76 0 226 19 327 39 356 75 709 282 953 561 197 225 337 505 403 802 30 134 38 470 15 623 -51 350 -215 685 -458 940 -218 228 -442 374 -720 466 -191 64 -285 80 -508 84 -107 2 -211 1 -230 -1z" />
        <Path d="M3235 3920 c-526 -56 -972 -511 -1002 -1022 l-6 -108 172 0 171 0 0 73 c0 92 29 199 83 302 32 62 65 103 142 180 89 90 112 107 205 153 115 57 183 77 290 88 l70 7 0 168 0 169 -27 -1 c-16 -1 -60 -5 -98 -9z" />
        <Path d="M1155 3603 c-563 -51 -1043 -491 -1140 -1047 -17 -99 -20 -334 -5 -436 35 -245 170 -509 355 -696 178 -180 376 -291 625 -351 99 -24 124 -26 443 -30 l337 -5 0 170 0 170 -327 5 c-289 4 -336 6 -398 24 -411 117 -689 454 -712 863 -3 59 0 140 6 185 16 110 69 259 127 357 66 111 211 256 322 322 133 79 321 136 450 136 l52 0 0 170 0 170 -47 -2 c-27 -1 -66 -3 -88 -5z" />
        <Path d="M2395 1898 c-88 -84 -222 -211 -298 -283 l-138 -130 108 -117 c59 -64 115 -116 123 -117 8 0 56 38 105 86 l90 86 3 -427 2 -426 170 0 170 0 2 425 3 425 97 -90 96 -90 111 117 c61 64 111 122 111 128 0 7 -21 32 -47 55 -27 24 -84 77 -128 119 -257 245 -413 391 -416 391 -2 0 -76 -69 -164 -152z" />
      </G>
    </Svg>
  );
}

interface ArtColors {
  accent: string;
  line: string;
  surface: string;
  bg: string;
  fg2: string;
}

/** 伴侣模式:大桌面窗口(带剪贴板列表)+ 贴在前面的小手机,表达「依附」而非平级 */
export function CompanionArt({
  accent,
  line,
  surface,
  bg,
  fg2,
  width = 224,
}: ArtColors & { width?: number }) {
  const h = Math.round((width * 128) / 232);
  return (
    <Svg width={width} height={h} viewBox="0 0 232 128">
      {/* desktop app window */}
      <Rect
        x={30}
        y={14}
        width={120}
        height={78}
        rx={8}
        fill={surface}
        stroke={line}
        strokeWidth={1.6}
      />
      <Line x1={30} y1={32} x2={150} y2={32} stroke={line} strokeWidth={1.4} />
      <Circle cx={40} cy={23} r={2} fill={fg2} opacity={0.6} />
      <Circle cx={48} cy={23} r={2} fill={fg2} opacity={0.6} />
      <Circle cx={56} cy={23} r={2} fill={fg2} opacity={0.6} />
      {/* clipboard rows */}
      <Line
        x1={42}
        y1={46}
        x2={92}
        y2={46}
        stroke={accent}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <Line
        x1={42}
        y1={56}
        x2={122}
        y2={56}
        stroke={fg2}
        strokeWidth={3.2}
        strokeLinecap="round"
        opacity={0.4}
      />
      <Line
        x1={42}
        y1={66}
        x2={106}
        y2={66}
        stroke={fg2}
        strokeWidth={3.2}
        strokeLinecap="round"
        opacity={0.4}
      />
      <Line
        x1={42}
        y1={76}
        x2={118}
        y2={76}
        stroke={fg2}
        strokeWidth={3.2}
        strokeLinecap="round"
        opacity={0.4}
      />
      {/* phone companion, in front / bottom-right */}
      <Rect
        x={128}
        y={44}
        width={48}
        height={72}
        rx={10}
        fill={bg}
        stroke={accent}
        strokeWidth={1.8}
      />
      <Line
        x1={138}
        y1={58}
        x2={166}
        y2={58}
        stroke={accent}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Line
        x1={138}
        y1={70}
        x2={160}
        y2={70}
        stroke={fg2}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.4}
      />
      <Line
        x1={146}
        y1={108}
        x2={158}
        y2={108}
        stroke={fg2}
        strokeWidth={2.4}
        strokeLinecap="round"
        opacity={0.5}
      />
    </Svg>
  );
}

/** 局域网直连:手机 + 电脑两个节点,虚线链路,顶部 Wi-Fi 弧 */
export function LanArt({
  accent,
  line,
  bg,
  fg2,
  width = 220,
}: Omit<ArtColors, 'surface'> & { width?: number }) {
  const h = Math.round((width * 96) / 220);
  return (
    <Svg width={width} height={h} viewBox="0 0 220 96">
      {/* wifi arcs from midpoint */}
      <Path
        d="M99 40 a15 15 0 0 1 22 0"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.9}
      />
      <Path
        d="M93 34 a24 24 0 0 1 34 0"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.55}
      />
      <Path
        d="M87 28 a33 33 0 0 1 46 0"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.3}
      />
      {/* link line */}
      <Line
        x1={54}
        y1={70}
        x2={166}
        y2={70}
        stroke={fg2}
        strokeWidth={1.4}
        strokeDasharray="2 5"
        strokeLinecap="round"
        opacity={0.7}
      />
      <Circle cx={78} cy={70} r={3} fill={accent} />
      <Circle cx={142} cy={70} r={3} fill={accent} />
      {/* phone node */}
      <Rect x={40} y={56} width={20} height={30} rx={4} fill={bg} stroke={fg2} strokeWidth={1.6} />
      <Line x1={47} y1={81} x2={53} y2={81} stroke={fg2} strokeWidth={1.6} strokeLinecap="round" />
      {/* desktop node */}
      <Rect x={156} y={54} width={30} height={21} rx={3} fill={bg} stroke={fg2} strokeWidth={1.6} />
      <Line x1={171} y1={75} x2={171} y2={82} stroke={fg2} strokeWidth={1.6} />
      <Line
        x1={165}
        y1={83}
        x2={177}
        y2={83}
        stroke={fg2}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

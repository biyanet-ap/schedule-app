/**
 * 캘린더 막대 색 계산 (v1.17). 설계: docs/design/project-color.md
 * - 대비는 WCAG 2.x 상대 휘도로 재고, 일반 글자 기준 4.5:1을 지킨다.
 * - 작업기록의 연한 배경은 CSS(color-mix)가 그리고, 여기서는 같은 공식으로 글자색만 정한다.
 */
export type Rgb = readonly [number, number, number];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** 일반 글자의 최소 대비 (WCAG 2.x AA) */
export const MIN_CONTRAST = 4.5;

/**
 * 연한 막대 글자색을 고를 때 쓰는 목표 대비. 4.5보다 조금 높게 잡아, 브라우저가 color-mix 결과를
 * 8비트로 반올림하는 방식이 JS와 1단계 달라도 4.5 아래로 내려가지 않게 한다 (v1.17 리뷰).
 */
export const TINT_TARGET_CONTRAST = 4.6;

/** 프로젝트 색 기본 팔레트 (프로젝트 관리 창과 테스트가 같이 쓴다) */
export const PALETTE = ['#2563eb', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#9333ea', '#ca8a04', '#475569'] as const;

/** 검증 안 된 값이 색 계산에 들어왔을 때 쓰는 중립 색 (호출하는 쪽은 safeColor를 먼저 거친다) */
const NEUTRAL = '#64748b';

/** 화면 바탕색. style.css의 --surface(라이트·다크)와 같아야 한다 — tests/gas/color-css-sync.test.ts가 확인 */
export const SURFACE = { light: '#ffffff', dark: '#161a22' } as const;

/** 작업기록 연한 배경에 섞는 프로젝트 색 비율. style.css의 --ev-tint-mix와 같아야 한다 (테스트로 확인) */
export const TINT_RATIO = { light: 0.18, dark: 0.32 } as const;

/** 완료 일정 막대의 연한 배경에 섞는 프로젝트 색 비율 (v1.18, 라이트·다크 같음). style.css의 --ev-done-mix와 같아야 한다 */
export const DONE_RATIO = 0.35;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** '#RRGGBB'만 색으로 인정한다. 그 밖의 문자열(url(...) 등)은 스타일에 넣지 않는다 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** 프로젝트 색이 '#RRGGBB'면 그대로, 아니면 기본색 */
export function safeColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

export function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
}

export function toHex(rgb: Rgb): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function linear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** a를 ratio, b를 1 - ratio만큼 섞는다. CSS color-mix(in srgb, a ratio, b)와 같은 계산 (8비트로 반올림) */
export function mix(a: Rgb, b: Rgb, ratio: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * ratio + b[i] * (1 - ratio))) as unknown as Rgb;
}

/** 색 계산 함수의 입력 정리: '#RRGGBB'만 소문자로, 아니면 중립 색 (NaN 색이 나오지 않게) */
function normalize(hex: string): string {
  return isHexColor(hex) ? hex.toLowerCase() : NEUTRAL;
}

const solidCache = new Map<string, string>();
const tintCache = new Map<string, { background: string; text: string }>();

/** 진한 막대(일정)의 글자색: 흰색·검정 중 대비가 큰 쪽. 어떤 배경이든 4.58:1 이상이 된다 */
export function solidTextColor(hex: string): string {
  const key = normalize(hex);
  let text = solidCache.get(key);
  if (!text) {
    const bg = parseHex(key);
    text = contrast(bg, WHITE) >= contrast(bg, BLACK) ? '#ffffff' : '#000000';
    solidCache.set(key, text);
  }
  return text;
}

/**
 * 완료 항목(일정·작업기록)의 글자색 (v1.18): 라이트는 검정, 다크는 흰색.
 * 완료 일정의 연한 배경(DONE_RATIO)과 작업기록의 연한 배경(TINT_RATIO) 모두에서 어떤 프로젝트 색이든 4.5:1을 넘는다
 * (라이트 최저: 검정 프로젝트 색 35% + 흰색 → 8.6, 다크 최저: 흰색 프로젝트 색 35% + #161a22 → 5.4).
 */
export function doneTextColor(dark: boolean): string {
  return dark ? '#ffffff' : '#000000';
}

/** 완료 일정 막대의 연한 배경 (CSS .ev-faded의 color-mix와 같은 계산 — 테스트·점검용) */
export function doneBackground(hex: string, dark: boolean): string {
  return toHex(mix(parseHex(normalize(hex)), parseHex(dark ? SURFACE.dark : SURFACE.light), DONE_RATIO));
}

/**
 * 연한 막대(작업기록)의 배경과 글자색.
 * 배경 = 프로젝트 색 TINT_RATIO + 화면 바탕색. 글자 = 프로젝트 색을 5%씩 검정(라이트)·흰색(다크) 쪽으로 섞어
 * 처음으로 TINT_TARGET_CONTRAST(4.6) 이상이 되는 색 (끝까지 가면 검정·흰색이고, 그때는 어떤 색이든 4.6을 넘는다:
 * 라이트 배경의 최저 휘도는 검정 18% + 흰색 82%, 다크 배경의 최고 휘도는 흰색 32% + #161a22 68%).
 */
export function tintColors(hex: string, dark: boolean): { background: string; text: string } {
  const base = normalize(hex);
  const key = `${base}|${dark ? 'd' : 'l'}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const color = parseHex(base);
  const bg = mix(color, parseHex(dark ? SURFACE.dark : SURFACE.light), dark ? TINT_RATIO.dark : TINT_RATIO.light);
  const target = dark ? WHITE : BLACK;
  let text = color;
  for (let step = 0; step <= 20; step++) {
    text = mix(target, color, step / 20);
    if (contrast(text, bg) >= TINT_TARGET_CONTRAST) break;
  }
  const result = { background: toHex(bg), text: toHex(text) };
  tintCache.set(key, result);
  return result;
}

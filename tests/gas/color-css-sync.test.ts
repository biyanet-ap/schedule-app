/**
 * 캘린더 프로젝트 색 (v1.17): 화면 CSS와 src/utils/color.ts의 계산 값이 같은지.
 * 작업기록 막대의 연한 배경은 CSS가 그리고 글자색은 TS가 계산하므로, 둘이 어긋나면 글자 대비 보장이 깨진다.
 * (파일을 읽어야 해서 Node 타입을 쓰는 이쪽에 둔다. 색 계산 자체 테스트는 tests/web/event-colors.test.ts)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DONE_RATIO, SURFACE, TINT_RATIO } from '../../src/utils/color';

const css = readFileSync('src/style.css', 'utf8');

/** 중괄호 짝을 맞춰 `head {` 블록의 안쪽을 돌려준다 (from 위치부터 처음 나오는 것) */
function block(src: string, head: string, from = 0): string {
  const start = src.indexOf(head, from);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('{', start) + 1, i);
  }
  return '';
}

/** 다크 모드 @media 블록들 가운데 :root 변수를 정하는 블록 */
function darkRoot(): string {
  for (let at = css.indexOf('@media (prefers-color-scheme: dark)'); at >= 0; at = css.indexOf('@media (prefers-color-scheme: dark)', at + 1)) {
    const inner = block(css, '@media (prefers-color-scheme: dark)', at);
    const root = block(inner, ':root');
    if (root) return root;
  }
  return '';
}

const pick = (part: string, name: string) => part.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe('CSS와 색 계산 값이 같은지 (v1.17)', () => {
  it('바탕색(--surface)과 연한 배경 비율(--ev-tint-mix): 라이트·다크', () => {
    const light = block(css, ':root');
    const dark = darkRoot();
    expect(dark).not.toBe('');
    expect(pick(light, 'surface')).toBe(SURFACE.light);
    expect(pick(dark, 'surface')).toBe(SURFACE.dark);
    expect(pick(light, 'ev-tint-mix')).toBe(`${Math.round(TINT_RATIO.light * 100)}%`);
    expect(pick(dark, 'ev-tint-mix')).toBe(`${Math.round(TINT_RATIO.dark * 100)}%`);
  });

  it('.ev-tint는 전역(style.css)에서 같은 공식으로 칠하고, 인쇄에서는 빠진다', () => {
    const screen = block(css, '@media not print');
    const rule = block(screen, ':root .ev-tint');
    expect(rule).toContain('background-color: color-mix(in srgb, var(--fc-event-color) var(--ev-tint-mix), var(--surface))');
    expect(rule).toContain('border-color: var(--fc-event-color)');
    // 「+N」 팝오버는 document.body에 그려지므로 .calendar-wrap 범위(scoped) 규칙이면 안 된다
    expect(readFileSync('src/components/CalendarView.vue', 'utf8')).not.toContain('ev-tint');
  });

  it('완료 일정 .ev-faded (v1.18): 비율(--ev-done-mix)이 계산과 같고, 전역·인쇄 제외, 다크에서 따로 바꾸지 않음', () => {
    expect(pick(block(css, ':root'), 'ev-done-mix')).toBe(`${Math.round(DONE_RATIO * 100)}%`);
    expect(pick(darkRoot(), 'ev-done-mix')).toBeUndefined();
    const rule = block(block(css, '@media not print'), ':root .ev-faded');
    expect(rule).toContain('background-color: color-mix(in srgb, var(--fc-event-color) var(--ev-done-mix), var(--surface))');
    // 테두리가 없어야 작업기록(테두리 있는 연한 막대)과 구분된다. 막대 전체 흐림(opacity)도 쓰지 않는다
    expect(rule).not.toMatch(/border|opacity/);
    expect(readFileSync('src/components/CalendarView.vue', 'utf8')).not.toContain('ev-faded');
  });

  it('휴대폰 목록 보기의 완료 줄 흐림 .ev-done은 opacity 0.55 그대로', () => {
    expect(block(css, '.ev-done').trim()).toBe('opacity: 0.55;');
  });
});

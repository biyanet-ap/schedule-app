/**
 * 캘린더 프로젝트 색 배경 (v1.17). 설계: docs/design/project-color.md
 */
import { describe, expect, it } from 'vitest';
import type { Project, Schedule, Worklog } from '../../src/api/types';
import { contrast, doneBackground, doneTextColor, DONE_RATIO, isHexColor, MIN_CONTRAST, PALETTE, parseHex, safeColor, solidTextColor, SURFACE, tintColors, TINT_RATIO, TINT_TARGET_CONTRAST, type Rgb } from '../../src/utils/color';
import { COLORS, legendProjects, scheduleColor, toEventInputs, worklogColor } from '../../src/utils/events';

const DEFAULTS = ['#3b82f6', COLORS.task, COLORS.meeting, COLORS.worklog];

/** 고정 시드 무작위 색 (xorshift32 — 32비트 정수 연산만 써서 값이 고르게 퍼진다) */
function randomColors(n: number): string[] {
  let x = 20261019 >>> 0;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  return Array.from({ length: n }, () => '#' + (next() & 0xffffff).toString(16).padStart(6, '0'));
}
/** 채널마다 16단계(0, 17, …, 255) 격자 4096색 */
const GRID = Array.from({ length: 4096 }, (_, i) => '#' + [i >> 8, (i >> 4) & 15, i & 15].map((v) => (v * 17).toString(16).padStart(2, '0')).join(''));
const RANDOM = randomColors(1000);
const EDGE = ['#000000', '#ffffff', '#808080', '#ffff00', '#00ffff', '#ff00ff', '#777777', '#767676'];
const ALL = [...PALETTE, ...DEFAULTS, ...EDGE, ...GRID, ...RANDOM];

const sched = (p: Partial<Schedule>): Schedule => ({
  id: 'a', type: 'TASK', title: 't', description: '', startAt: '2026-10-19T10:00', endAt: '2026-10-19T11:00', allDay: false,
  priority: 'MEDIUM', projectId: '', location: '', status: 'PLANNED', tags: [], createdAt: '', updatedAt: '', ...p,
});
const wlog = (p: Partial<Worklog>): Worklog => ({
  id: 'w', workDate: '2026-10-19', endDate: '', title: '기록', content: '', projectId: '', scheduleId: '', tags: [],
  status: 'IN_PROGRESS', createdAt: '', updatedAt: '', ...p,
});
const proj = (id: string, color: string, name = id): Project => ({ id, name, color, sortOrder: 0, active: true, updatedAt: '' });
const empty = { schedules: [] as Schedule[], worklogs: [] as Worklog[], calendarEvents: [], holidays: [] };
const NO_FILTER = { projectId: '', showGcal: true };

describe('글자 대비 4.5:1 이상', () => {
  it('표본: 격자 4096색 + 서로 다른 무작위 1000색', () => {
    expect(new Set(GRID).size).toBe(4096);
    expect(new Set(RANDOM).size).toBeGreaterThanOrEqual(995);
    expect(ALL.every(isHexColor)).toBe(true);
  });

  it('진한 막대(일정): 흰색·검정 중 대비가 큰 쪽, 어떤 색이든 4.5 이상', () => {
    for (const c of ALL) {
      const text = solidTextColor(c);
      expect(['#ffffff', '#000000']).toContain(text);
      expect(contrast(parseHex(c), parseHex(text)), c).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('흰 글자로 부족한 색은 검정 글자 (주황·청록·연두·노랑·서버 기본색)', () => {
    expect(['#2563eb', '#db2777', '#9333ea', '#475569', COLORS.meeting, COLORS.worklog].map(solidTextColor)).toEqual(Array(6).fill('#ffffff'));
    expect(['#ea580c', '#0891b2', '#65a30d', '#ca8a04', '#3b82f6'].map(solidTextColor)).toEqual(Array(5).fill('#000000'));
  });

  it.each([['라이트', false], ['다크', true]] as const)('연한 막대(작업기록) %s: 목표 4.6, 반올림 전 배경·반올림이 1단계 다른 배경에서도 4.5 이상', (_label, dark) => {
    const surface = parseHex(dark ? SURFACE.dark : SURFACE.light);
    const ratio = dark ? TINT_RATIO.dark : TINT_RATIO.light;
    for (const c of ALL) {
      const { background, text } = tintColors(c, dark);
      const t = parseHex(text);
      expect(contrast(parseHex(background), t), `${c} ${background} ${text}`).toBeGreaterThanOrEqual(TINT_TARGET_CONTRAST);
      // CSS color-mix의 실수 결과 (반올림 전)
      const raw = parseHex(c).map((v, i) => v * ratio + surface[i] * (1 - ratio)) as unknown as Rgb;
      expect(contrast(raw, t), `${c} 실수 배경`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      // 다른 브라우저가 1단계 다르게 반올림한 경우 중 나쁜 쪽 (라이트는 배경이 어두워지는 쪽, 다크는 밝아지는 쪽)
      const near = parseHex(background).map((v) => Math.min(255, Math.max(0, v + (dark ? 1 : -1)))) as unknown as Rgb;
      expect(contrast(near, t), `${c} ±1 배경`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('설계 문서 2.1 예시 표와 같은 값 (CSS color-mix와 같은 계산)', () => {
    expect(tintColors('#2563eb', false)).toEqual({ background: '#d8e3fb', text: '#2159d4' });
    expect(tintColors('#2563eb', true)).toEqual({ background: '#1b3162', text: '#7ca1f3' });
    expect(tintColors('#ea580c', false)).toEqual({ background: '#fbe1d3', text: '#b04209' });
    expect(tintColors('#ca8a04', false)).toEqual({ background: '#f5ead2', text: '#835a03' });
    expect(tintColors('#9333ea', true)).toEqual({ background: '#3e2262', text: '#be85f2' });
  });

  it('대소문자가 달라도 같은 결과, 검증 안 된 값이 들어와도 NaN 색을 만들지 않음', () => {
    expect(solidTextColor('#EA580C')).toBe(solidTextColor('#ea580c'));
    expect(tintColors('#2563EB', true)).toEqual(tintColors('#2563eb', true));
    for (const bad of ['red', '#fff', '', 'url(x)']) {
      expect(solidTextColor(bad)).toMatch(/^#[0-9a-f]{6}$/);
      const t = tintColors(bad, false);
      expect(`${t.background}${t.text}`).toMatch(/^#[0-9a-f]{6}#[0-9a-f]{6}$/);
    }
  });
});

describe('색 값 검증', () => {
  it("'#RRGGBB'만 인정하고 나머지는 기본색", () => {
    expect(isHexColor('#AbCdEf')).toBe(true);
    for (const bad of ['red', '#fff', '#12345g', ' #123456', '#123456 ', 'url(https://example.com/a.png)', '#123456;color:red', '', null, undefined, 123]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
      expect(safeColor(bad, '#000001')).toBe('#000001');
    }
  });
});

describe('달력 표시 규칙', () => {
  const projects = [proj('p1', '#ea580c'), proj('p2', '#9333ea'), proj('bad', 'url(https://example.com/x.png)')];

  it('작업 일정: 프로젝트 색 막대(시간 있는 일정도 block), 글자색 자동 / 프로젝트 없으면 파랑', () => {
    const ev = toEventInputs({ ...empty, schedules: [sched({ id: 'a', projectId: 'p1' }), sched({ id: 'b' })] }, projects, NO_FILTER);
    expect(ev.find((e) => e.id === 's:a')).toMatchObject({ color: '#ea580c', contrastColor: '#000000', display: 'block' });
    expect(ev.find((e) => e.id === 's:b')).toMatchObject({ color: COLORS.task, contrastColor: '#ffffff', display: 'block' });
  });

  it('예정 일정은 클래스 없음 (완료 일정은 아래 v1.18 묶음)', () => {
    const ev = toEventInputs({ ...empty, schedules: [sched({ id: 'b' })] }, projects, NO_FILTER);
    expect(ev.find((e) => e.id === 's:b')!.className).toBe('');
  });

  it('회의 일정: 프로젝트 색을 따르고, 프로젝트가 없으면 보라', () => {
    const ev = toEventInputs({ ...empty, schedules: [sched({ id: 'a', type: 'MEETING', projectId: 'p2' }), sched({ id: 'b', type: 'MEETING' })] }, projects, NO_FILTER);
    expect(ev.find((e) => e.id === 's:a')).toMatchObject({ color: '#9333ea', display: 'block' });
    expect(ev.find((e) => e.id === 's:b')).toMatchObject({ color: COLORS.meeting, display: 'block' });
  });

  it('프로젝트 색이 #RRGGBB가 아니면 종류 기본색 (스타일에 그대로 넣지 않음)', () => {
    const ev = toEventInputs({
      ...empty,
      schedules: [sched({ id: 'a', projectId: 'bad' }), sched({ id: 'b', type: 'MEETING', projectId: 'bad' })],
      worklogs: [wlog({ id: 'c', projectId: 'bad' })],
    }, projects, NO_FILTER);
    expect(ev.map((e) => e.color)).toEqual([COLORS.task, COLORS.meeting, COLORS.worklog]);
    expect(JSON.stringify(ev)).not.toContain('url(');
  });

  it('작업기록: 프로젝트 색 + 연한 배경(ev-tint), 글자색은 라이트·다크별 / 프로젝트 없으면 초록', () => {
    const data = { ...empty, worklogs: [wlog({ id: 'a', projectId: 'p1' }), wlog({ id: 'b', status: 'DONE' })] };
    const light = toEventInputs(data, projects, NO_FILTER, { dark: false, list: false });
    expect(light.find((e) => e.id === 'w:a')).toMatchObject({ color: '#ea580c', className: 'ev-tint', contrastColor: tintColors('#ea580c', false).text });
    expect(light.find((e) => e.id === 'w:b')).toMatchObject({ color: COLORS.worklog, className: 'ev-tint' });
    expect(light.find((e) => e.id === 'w:a')).not.toHaveProperty('display');
    const dark = toEventInputs(data, projects, NO_FILTER, { dark: true, list: false });
    expect(dark.find((e) => e.id === 'w:a')!.contrastColor).toBe(tintColors('#ea580c', true).text);
  });

  it('휴대폰 목록 보기: 연한 배경 없이 점만 (점 색 = 프로젝트 색), 완료 흐림은 유지', () => {
    const ev = toEventInputs({ ...empty, worklogs: [wlog({ id: 'a', projectId: 'p1' }), wlog({ id: 'b', projectId: 'p1', status: 'DONE' })] }, projects, NO_FILTER, { dark: false, list: true });
    expect(ev.find((e) => e.id === 'w:a')).toMatchObject({ color: '#ea580c', className: '' });
    expect(ev.find((e) => e.id === 'w:b')).toMatchObject({ className: 'ev-done' });
  });

  it('구글 캘린더 회의·공휴일은 그대로 (점 표시·고정 색)', () => {
    const ev = toEventInputs({
      ...empty,
      calendarEvents: [{ id: 'g', title: '회의', startAt: '2026-10-19T13:00', endAt: '2026-10-19T14:00', allDay: false, location: '' }],
      holidays: [{ date: '2026-10-12', name: 'スポーツの日' }],
    }, projects, NO_FILTER);
    const g = ev.find((e) => e.id === 'c:g')!;
    expect(g.color).toBe(COLORS.gcal);
    expect(g).not.toHaveProperty('display');
    expect(g).not.toHaveProperty('contrastColor');
    expect(ev.find((e) => e.id === 'h:2026-10-12')).toMatchObject({ color: COLORS.holidayBg, contrastColor: COLORS.holidayText });
  });

  it('날짜 패널용 색 함수도 같은 규칙', () => {
    expect(scheduleColor({ type: 'MEETING' }, proj('x', '#0891b2'))).toBe('#0891b2');
    expect(scheduleColor({ type: 'MEETING' }, undefined)).toBe(COLORS.meeting);
    expect(scheduleColor({ type: 'TASK' }, undefined)).toBe(COLORS.task);
    expect(worklogColor(proj('x', '#0891b2'))).toBe('#0891b2');
    expect(worklogColor(proj('x', 'tomato'))).toBe(COLORS.worklog);
    expect(worklogColor(undefined)).toBe(COLORS.worklog);
  });
});

describe('완료 항목: 연한 배경 + 검정 글자 (v1.18)', () => {
  const projects = [proj('p1', '#2563eb'), proj('p2', '#ca8a04')];
  const data = {
    ...empty,
    schedules: [sched({ id: 'd', projectId: 'p1', status: 'DONE' }), sched({ id: 'm', type: 'MEETING', projectId: 'p2', status: 'DONE' }), sched({ id: 'n', projectId: 'p1', status: 'DONE' })],
    worklogs: [wlog({ id: 'wd', projectId: 'p1', status: 'DONE' }), wlog({ id: 'wi', projectId: 'p1' })],
  };
  const pick = (ev: ReturnType<typeof toEventInputs>, id: string) => ev.find((e) => e.id === id)!;

  it('PC 라이트: 완료 일정은 ev-faded + 검정, 흐림(ev-done) 없음. 색은 프로젝트 색 그대로', () => {
    const ev = toEventInputs(data, projects, NO_FILTER, { dark: false, list: false });
    expect(pick(ev, 's:d')).toMatchObject({ className: 'ev-faded', contrastColor: '#000000', color: '#2563eb', display: 'block', title: '✓ t' });
    expect(pick(ev, 's:m')).toMatchObject({ className: 'ev-faded', contrastColor: '#000000', color: '#ca8a04' });
    expect(ev.some((e) => String(e.className).includes('ev-done'))).toBe(false);
  });

  it('PC 다크: 완료 일정·기록 글자는 흰색 (진한 막대라면 검정이 되는 노랑 회의도)', () => {
    const ev = toEventInputs(data, projects, NO_FILTER, { dark: true, list: false });
    expect(pick(ev, 's:d').contrastColor).toBe('#ffffff');
    expect(solidTextColor('#ca8a04')).toBe('#000000');
    expect(pick(ev, 's:m').contrastColor).toBe('#ffffff');
    expect(pick(ev, 'w:wd')).toMatchObject({ className: 'ev-tint', contrastColor: '#ffffff' });
  });

  it('완료 작업기록: 같은 연한 막대(ev-tint)에 글자만 검정, 진행 중 기록은 프로젝트 색 글자 그대로', () => {
    const ev = toEventInputs(data, projects, NO_FILTER, { dark: false, list: false });
    expect(pick(ev, 'w:wd')).toMatchObject({ className: 'ev-tint', contrastColor: '#000000', title: '✓ 기록' });
    expect(pick(ev, 'w:wi')).toMatchObject({ className: 'ev-tint', contrastColor: tintColors('#2563eb', false).text, title: '✎ 기록' });
  });

  it('휴대폰 목록 보기: 완료 줄은 지금처럼 흐리게(ev-done), 연한 배경 클래스 없음', () => {
    const ev = toEventInputs(data, projects, NO_FILTER, { dark: false, list: true });
    expect(pick(ev, 's:d').className).toBe('ev-done');
    expect(pick(ev, 'w:wd').className).toBe('ev-done');
    expect(pick(ev, 'w:wi').className).toBe('');
  });

  it('예정 일정은 그대로 진한 막대 (끝난 시각과 관계없음)', () => {
    const past = sched({ id: 'p', projectId: 'p1', startAt: '2020-01-01T09:00', endAt: '2020-01-01T10:00' });
    const ev = toEventInputs({ ...empty, schedules: [past] }, projects, NO_FILTER);
    expect(pick(ev, 's:p')).toMatchObject({ className: '', contrastColor: '#ffffff' });
  });

  it.each([['라이트', false], ['다크', true]] as const)('%s: 어떤 프로젝트 색이든 완료 글자 대비 4.6 이상 (반올림 전 배경에서도 4.5 이상)', (_label, dark) => {
    const text = parseHex(doneTextColor(dark));
    const surface = parseHex(dark ? SURFACE.dark : SURFACE.light);
    for (const c of ALL) {
      const faded = doneBackground(c, dark);
      expect(contrast(parseHex(faded), text), `${c} 완료 일정 ${faded}`).toBeGreaterThanOrEqual(TINT_TARGET_CONTRAST);
      const raw = parseHex(c).map((v, i) => v * DONE_RATIO + surface[i] * (1 - DONE_RATIO)) as unknown as Rgb;
      expect(contrast(raw, text), `${c} 실수 배경`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      const tint = tintColors(c, dark).background;
      expect(contrast(parseHex(tint), text), `${c} 완료 기록 ${tint}`).toBeGreaterThanOrEqual(TINT_TARGET_CONTRAST);
    }
  });

  it.each([['라이트', false], ['다크', true]] as const)('%s: toEventInputs가 낸 완료 일정·기록 글자색이 어떤 프로젝트 색이든 실제 배경과 4.5 이상', (_label, dark) => {
    const many = ALL.map((c, i) => proj(`x${i}`, c));
    const ev = toEventInputs({
      ...empty,
      schedules: many.map((p) => sched({ id: p.id, projectId: p.id, status: 'DONE' })),
      worklogs: many.map((p) => wlog({ id: p.id, projectId: p.id, status: 'DONE' })),
    }, many, NO_FILTER, { dark, list: false });
    for (const p of many) {
      const s = pick(ev, `s:${p.id}`);
      expect(contrast(parseHex(doneBackground(p.color, dark)), parseHex(String(s.contrastColor))), `${p.color} 완료 일정`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      const w = pick(ev, `w:${p.id}`);
      expect(contrast(parseHex(tintColors(p.color, dark).background), parseHex(String(w.contrastColor))), `${p.color} 완료 기록`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('설계 문서 8.2 예시 값', () => {
    expect(doneBackground('#2563eb', false)).toBe('#b3c8f8');
    expect(doneBackground('#2563eb', true)).toBe('#1b3468');
    expect(doneBackground('red', false)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('범례의 프로젝트 목록', () => {
  const projects = [proj('p1', '#2563eb', 'A'), proj('p2', '#ea580c', 'B'), proj('p3', '#65a30d', 'C'), proj('p4', 'nope', 'D')];

  it('보이는 범위에 나오는 프로젝트만, 프로젝트 목록 순서대로, 취소 일정은 세지 않음', () => {
    const data = {
      schedules: [sched({ projectId: 'p3' }), sched({ projectId: 'p2', status: 'CANCELLED' }), sched({ projectId: '' })],
      worklogs: [wlog({ projectId: 'p1' }), wlog({ projectId: 'p1' })],
    };
    expect(legendProjects(data, projects, { projectId: '' })).toEqual([
      { id: 'p1', name: 'A', color: '#2563eb' },
      { id: 'p3', name: 'C', color: '#65a30d' },
    ]);
  });

  it('프로젝트 필터를 고르면 그 프로젝트만', () => {
    const data = { schedules: [sched({ projectId: 'p3' })], worklogs: [wlog({ projectId: 'p1' })] };
    expect(legendProjects(data, projects, { projectId: 'p3' }).map((p) => p.id)).toEqual(['p3']);
  });

  it('프로젝트 있는 항목이 없으면 빈 목록', () => {
    expect(legendProjects({ schedules: [sched({})], worklogs: [wlog({})] }, projects, { projectId: '' })).toEqual([]);
  });

  it('색이 #RRGGBB가 아닌 프로젝트는 뺀다 (막대가 종류별 기본색이라 한 색으로 설명할 수 없음)', () => {
    expect(legendProjects({ schedules: [sched({ projectId: 'p4' }), sched({ projectId: 'p1' })], worklogs: [] }, projects, { projectId: '' }).map((p) => p.id)).toEqual(['p1']);
  });

  it('사용 중지한 프로젝트도 보이는 항목에 쓰였으면 범례에 나온다', () => {
    const list = [{ ...proj('old', '#0891b2', '옛 프로젝트'), active: false }, ...projects];
    expect(legendProjects({ schedules: [], worklogs: [wlog({ projectId: 'old' })] }, list, { projectId: '' })).toEqual([{ id: 'old', name: '옛 프로젝트', color: '#0891b2' }]);
  });

  it('달력과 같은 노출 규칙: 필터에 걸러진 일정·기록의 프로젝트는 세지 않음', () => {
    const data = { schedules: [sched({ projectId: 'p2' })], worklogs: [wlog({ projectId: 'p3' })] };
    const shown = toEventInputs({ ...empty, ...data }, projects, { projectId: 'p2', showGcal: true }).map((e) => e.id);
    expect(shown).toEqual(['s:a']);
    expect(legendProjects(data, projects, { projectId: 'p2' }).map((p) => p.id)).toEqual(['p2']);
  });
});

// CSS(--surface, --ev-tint-mix, .ev-tint)와 계산 값이 같은지는 tests/gas/color-css-sync.test.ts (파일 읽기가 필요해서 Node 쪽)

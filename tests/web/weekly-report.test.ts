import { describe, expect, it } from 'vitest';
import type { Project, Schedule, Worklog } from '../../src/api/types';
import { buildWeeklyReport, reportWeekLabel, scheduleWhen } from '../../src/utils/weeklyReport';

const P = (id: string, name: string, sortOrder: number): Project => ({ id, name, color: '#000000', sortOrder, active: true, updatedAt: '' });
const projects = [P('pb', '프로젝트 B', 2), P('pa', '프로젝트 A', 1)];

let seq = 0;
const W = (p: Partial<Worklog> & Pick<Worklog, 'title' | 'workDate'>): Worklog => ({
  id: 'w' + ++seq, endDate: '', content: '', projectId: '', scheduleId: '', tags: [], status: 'IN_PROGRESS',
  createdAt: `c${String(seq).padStart(3, '0')}`, updatedAt: '', ...p,
});
const S = (p: Partial<Schedule> & Pick<Schedule, 'title' | 'startAt' | 'endAt'>): Schedule => ({
  id: 's' + ++seq, type: 'TASK', description: '', allDay: false, priority: 'MEDIUM', projectId: '', location: '',
  status: 'PLANNED', tags: [], createdAt: `c${String(seq).padStart(3, '0')}`, updatedAt: '', ...p,
});

const MON = '2026-09-21';
const TODAY = '2026-09-23'; // 수요일

describe('주간 보고 — 구역별 포함 기준', () => {
  const data = {
    worklogs: [
      W({ title: 'A 완료', workDate: '2026-09-22', projectId: 'pa', status: 'DONE' }),
      W({ title: 'B 완료', workDate: '2026-09-21', projectId: 'pb', status: 'DONE' }),
      W({ title: '기타 완료', workDate: '2026-09-25', status: 'DONE' }),
      W({ title: 'A 진행', workDate: '2026-09-24', projectId: 'pa' }),
      W({ title: '지난주부터 이어진 기간', workDate: '2026-09-17', endDate: '2026-09-22', projectId: 'pa' }),
      W({ title: '토요일 기록', workDate: '2026-09-26', status: 'DONE' }),
      W({ title: '주말만 기간', workDate: '2026-09-26', endDate: '2026-09-27' }),
      W({ title: '지난주 기록', workDate: '2026-09-18', status: 'DONE' }),
      W({ title: '모르는 프로젝트', workDate: '2026-09-23', projectId: 'gone', status: 'DONE' }),
    ],
    schedules: [
      S({ title: '월요일 못 한 작업', startAt: '2026-09-21T10:00', endAt: '2026-09-21T11:00', projectId: 'pa' }),
      S({ title: '오늘까지 작업', startAt: '2026-09-23', endAt: '2026-09-23', allDay: true }),
      S({ title: '내일 작업', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' }), // 아직 기한 전
      S({ title: '끝난 작업', startAt: '2026-09-22T10:00', endAt: '2026-09-22T11:00', status: 'DONE' }),
      S({ title: '취소된 작업', startAt: '2026-09-22T10:00', endAt: '2026-09-22T11:00', status: 'CANCELLED' }),
      S({ title: '월요일 회의', type: 'MEETING', startAt: '2026-09-21T15:00', endAt: '2026-09-21T16:00' }),
      S({ title: '다음 주 작업', startAt: '2026-10-02T10:00', endAt: '2026-10-02T11:00', projectId: 'pb' }),
      S({ title: '다음 주 회의', type: 'MEETING', startAt: '2026-09-29T14:00', endAt: '2026-09-29T15:00' }),
      S({ title: '주말부터 걸친 작업', startAt: '2026-09-26', endAt: '2026-09-28', allDay: true }),
      S({ title: '다음 주 끝난 작업', startAt: '2026-09-30T10:00', endAt: '2026-09-30T11:00', status: 'DONE' }),
      S({ title: '다다음 주 작업', startAt: '2026-10-05T10:00', endAt: '2026-10-05T11:00' }),
    ],
  };
  const r = buildWeeklyReport(data, projects, MON, TODAY);

  it('완료·진행 중: 월~금과 겹치는 작업기록 (주말·지난주 제외, 기간 기록은 겹치면 포함)', () => {
    expect(r.counts).toEqual({ done: 4, inProgress: 2, overdue: 2, nextWeek: 3 });
    expect(r.text).not.toContain('토요일 기록');
    expect(r.text).not.toContain('주말만 기간');
    expect(r.text).not.toContain('지난주 기록');
    expect(r.text).toContain('- 지난주부터 이어진 기간');
  });

  it('미완료 일정: 예정인 작업 중 기한이 오늘까지 (회의·완료·취소·내일 이후 제외)', () => {
    const overdue = r.text.split('■ 미완료 일정')[1].split('■')[0];
    expect(overdue).toContain('월요일 못 한 작업 (9/21 월 10:00)');
    expect(overdue).toContain('오늘까지 작업 (9/23 수)');
    for (const t of ['내일 작업', '끝난 작업', '취소된 작업', '월요일 회의']) expect(overdue).not.toContain(t);
  });

  it('다음 주 예정: 다음 주 월~금과 겹치는 예정 일정 (작업·회의, 완료·다다음 주 제외)', () => {
    const next = r.text.split('■ 다음 주 예정 (9/28 ~ 10/2) (3)')[1];
    expect(next).toBeDefined();
    expect(next).toContain('다음 주 작업 (10/2 금 10:00)');
    expect(next).toContain('다음 주 회의 (9/29 화 14:00)');
    expect(next).toContain('주말부터 걸친 작업 (9/26 ~ 9/28)');
    expect(next).not.toContain('다음 주 끝난 작업');
    expect(next).not.toContain('다다음 주 작업');
  });

  it('프로젝트 정렬 순서로 묶고, 프로젝트 없음·모르는 프로젝트는 맨 뒤 [기타]', () => {
    const doneBlock = r.text.split('■ 완료한 작업 (4)\n')[1].split('\n\n')[0];
    expect(doneBlock).toBe(['[프로젝트 A]', '- A 완료', '[프로젝트 B]', '- B 완료', '[기타]', '- 모르는 프로젝트', '- 기타 완료'].join('\n'));
  });

  it('전체 글 모양 (머리말·구역 순서·빈 줄)', () => {
    const lines = r.text.split('\n');
    expect(lines[0]).toBe('[주간 업무 보고] 2026년 9월 21일 (월) ~ 25일 (금)');
    expect(lines[1]).toBe('');
    expect(lines.filter((l) => l.startsWith('■ '))).toEqual([
      '■ 완료한 작업 (4)', '■ 진행 중인 작업 (2)', '■ 미완료 일정 (2)', '■ 다음 주 예정 (9/28 ~ 10/2) (3)',
    ]);
  });
});

describe('주간 보고 — 빈 주와 표시 형식', () => {
  it('항목이 없는 구역은 "- 없음"', () => {
    const r = buildWeeklyReport({ worklogs: [], schedules: [] }, projects, MON, TODAY);
    expect(r.counts).toEqual({ done: 0, inProgress: 0, overdue: 0, nextWeek: 0 });
    expect(r.text.match(/- 없음/g)).toHaveLength(4);
  });

  it('머리말: 달·해가 바뀌는 주', () => {
    expect(reportWeekLabel('2026-09-28')).toBe('2026년 9월 28일 (월) ~ 10월 2일 (금)');
    expect(reportWeekLabel('2026-12-28')).toBe('2026년 12월 28일 (월) ~ 2027년 1월 1일 (금)');
  });

  it('일정 날짜 표시: 종일 하루 / 종일 여러 날 / 시각 / 밤을 넘기는 시각', () => {
    expect(scheduleWhen(S({ title: 'x', startAt: '2026-09-22', endAt: '2026-09-22', allDay: true }))).toBe('(9/22 화)');
    expect(scheduleWhen(S({ title: 'x', startAt: '2026-09-26', endAt: '2026-09-28', allDay: true }))).toBe('(9/26 ~ 9/28)');
    expect(scheduleWhen(S({ title: 'x', startAt: '2026-10-02T10:00', endAt: '2026-10-02T11:00' }))).toBe('(10/2 금 10:00)');
    expect(scheduleWhen(S({ title: 'x', startAt: '2026-09-24T22:00', endAt: '2026-09-25T02:00' }))).toBe('(9/24 22:00 ~ 9/25 02:00)');
    // 다음날 0시에 끝나는 시각 일정은 하루짜리로 본다 (캘린더와 같은 규칙)
    expect(scheduleWhen(S({ title: 'x', startAt: '2026-09-24T22:00', endAt: '2026-09-25T00:00' }))).toBe('(9/24 목 22:00)');
  });

  it('지난 주 보고는 그 주 금요일까지의 미완료를 모두 포함 (오늘이 이후라서)', () => {
    const r = buildWeeklyReport({
      worklogs: [],
      schedules: [S({ title: '금요일 작업', startAt: '2026-09-18T10:00', endAt: '2026-09-18T11:00' })],
    }, projects, '2026-09-14', TODAY);
    expect(r.counts.overdue).toBe(1);
  });
});

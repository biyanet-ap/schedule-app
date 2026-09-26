import { describe, expect, it } from 'vitest';
import type { Diary, Schedule, Worklog } from '../../src/api/types';
import { countByKind, deletedAtLabel, mergeTrash, worklogDateText } from '../../src/utils/trash';

const S = (p: Partial<Schedule> & Pick<Schedule, 'id' | 'title' | 'startAt' | 'endAt' | 'updatedAt'>): Schedule => ({
  type: 'TASK', description: '', allDay: false, priority: 'MEDIUM', projectId: '', location: '', status: 'PLANNED', tags: [], createdAt: 'c', ...p,
});
const W = (p: Partial<Worklog> & Pick<Worklog, 'id' | 'title' | 'workDate' | 'updatedAt'>): Worklog => ({
  endDate: '', content: '', projectId: '', scheduleId: '', tags: [], status: 'IN_PROGRESS', createdAt: 'c', ...p,
});
const D = (p: Pick<Diary, 'id' | 'diaryDate' | 'title' | 'updatedAt'>): Diary => ({ content: 'c', createdAt: 'c', ...p });

describe('휴지통 목록 합치기', () => {
  const data = {
    schedules: [
      S({ id: 's1', title: '시각 일정', startAt: '2026-09-22T13:00', endAt: '2026-09-22T14:00', projectId: 'pa', updatedAt: '2026-09-25T10:00:00.000+09:00' }),
      S({ id: 's2', title: '종일 여러 날', allDay: true, startAt: '2026-09-26T00:00', endAt: '2026-09-28T00:00', updatedAt: '2026-09-20T08:00:00.000+09:00' }),
    ],
    worklogs: [
      W({ id: 'w1', title: '하루 기록', workDate: '2026-09-24', updatedAt: '2026-09-25T14:03:10.123+09:00' }),
      W({ id: 'w2', title: '기간 기록', workDate: '2026-09-21', endDate: '2026-09-25', projectId: 'pb', updatedAt: '2026-09-25T10:00:00.000+09:00' }),
    ],
    diaries: [D({ id: 'd1', diaryDate: '2026-09-24', title: '비 오는 날', updatedAt: '2026-09-23T22:10:00.000+09:00' })],
  };
  const list = mergeTrash(data);

  it('최근 삭제 순, 같은 시각이면 일정 → 작업기록 → 다이어리', () => {
    expect(list.map((e) => e.key)).toEqual(['W:w1', 'S:s1', 'W:w2', 'D:d1', 'S:s2']);
  });

  it('줄마다 날짜 문구·이동 날짜·프로젝트·잠금 값', () => {
    const by = Object.fromEntries(list.map((e) => [e.key, e]));
    expect(by['S:s1']).toMatchObject({ kind: 'SCHEDULE', id: 's1', when: '9/22 화 13:00', goDate: '2026-09-22', projectId: 'pa' });
    expect(by['S:s2']).toMatchObject({ when: '9/26 ~ 9/28', goDate: '2026-09-26' });
    expect(by['W:w1']).toMatchObject({ kind: 'WORKLOG', when: '9/24', goDate: '2026-09-24' });
    expect(by['W:w2']).toMatchObject({ when: '9/21~9/25', goDate: '2026-09-21', projectId: 'pb' });
    expect(by['D:d1']).toMatchObject({ kind: 'DIARY', title: '비 오는 날', when: '9/24 (목)', goDate: '2026-09-24', projectId: '' });
    // 복구 잠금 값 = 삭제 시각 = 서버 updatedAt
    expect(by['W:w1'].updatedAt).toBe('2026-09-25T14:03:10.123+09:00');
    expect(by['W:w1'].deletedAt).toBe(by['W:w1'].updatedAt);
  });

  it('종류별 건수', () => {
    expect(countByKind(list)).toEqual({ ALL: 5, SCHEDULE: 2, WORKLOG: 2, DIARY: 1 });
    expect(countByKind([])).toEqual({ ALL: 0, SCHEDULE: 0, WORKLOG: 0, DIARY: 0 });
  });
});

describe('휴지통 문구', () => {
  it('삭제 시각: 서버 시각 → 9/25 14:03, 형식이 아니면 빈 문자열', () => {
    expect(deletedAtLabel('2026-09-25T14:03:10.123+09:00')).toBe('9/25 14:03');
    expect(deletedAtLabel('2026-10-01T09:05:00+09:00')).toBe('10/1 09:05');
    expect(deletedAtLabel('어제쯤')).toBe('');
  });

  it('작업기록 날짜: 하루 / 기간', () => {
    expect(worklogDateText({ workDate: '2026-09-24', endDate: '' })).toBe('9/24');
    expect(worklogDateText({ workDate: '2026-09-28', endDate: '2026-10-02' })).toBe('9/28~10/2');
  });
});

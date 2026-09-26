import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult } from './harness';

interface Diary { id: string; diaryDate: string; title: string; content: string; createdAt: string; updatedAt: string }
type Gas = ReturnType<typeof createReadyGas>;

const save = (gas: Gas, input: Record<string, unknown>) => gas.call<ApiResult<Diary>>('apiSaveDiary', input);
const range = (gas: Gas, from: string, to: string) => ok(gas.call<ApiResult<Diary[]>>('apiGetDiaries', { from, to }));
const search = (gas: Gas, keyword: string) => ok(gas.call<ApiResult<{ diaries: Diary[]; truncated: boolean }>>('apiSearchDiaries', { keyword }));

describe('다이어리 저장', () => {
  it('타이틀을 비우면 날짜 문구로 채운다 (공백만 있어도)', () => {
    const gas = createReadyGas();
    expect(ok(save(gas, { diaryDate: '2026-09-25', title: '', content: '오늘은 비' })).title).toBe('2026년 9월 25일 (금)');
    expect(ok(save(gas, { diaryDate: '2026-10-04', title: '   ', content: '산책' })).title).toBe('2026년 10월 4일 (일)');
    expect(ok(save(gas, { diaryDate: '2026-10-05', content: '타이틀 없이 보냄' })).title).toBe('2026년 10월 5일 (월)');
    const d = ok(save(gas, { diaryDate: '2026-10-06', title: '  첫 출근  ', content: '줄1\r\n줄2' }));
    expect(d).toMatchObject({ title: '첫 출근', content: '줄1\n줄2' });
    // 시트에도 채워진 타이틀이 저장된다 (id, diary_date, title, content, ...)
    expect(gas.sheet('diaries').rawRow(2).slice(1, 4)).toEqual(['2026-09-25', '2026년 9월 25일 (금)', '오늘은 비']);
  });

  it('입력 검증: 내용 필수, 길이, 날짜 형식', () => {
    const gas = createReadyGas();
    expect(err(save(gas, { diaryDate: '2026-09-25', title: 't', content: '  ' })).message).toBe('내용을 입력해 주세요.');
    expect(err(save(gas, { diaryDate: '2026-09-25', title: 'x'.repeat(201), content: 'c' })).message).toBe('타이틀은 200자 이내로 입력해 주세요.');
    expect(err(save(gas, { diaryDate: '2026-09-25', content: 'c'.repeat(20001) })).message).toBe('내용은 20000자 이내로 입력해 주세요.');
    expect(err(save(gas, { diaryDate: '2026-02-30', content: 'c' })).message).toBe('날짜가 올바른 날짜가 아닙니다. (YYYY-MM-DD)');
    expect(gas.sheet('diaries').getLastRow()).toBe(1);
  });

  it('수식처럼 보이는 입력도 글자 그대로 저장·표시', () => {
    const gas = createReadyGas();
    const d = ok(save(gas, { diaryDate: '2026-09-25', title: '=SUM(A1)', content: '+81 연락' }));
    expect(d).toMatchObject({ title: '=SUM(A1)', content: '+81 연락' });
    expect(gas.sheet('diaries').rawRow(2)[2]).toBe('⁠=SUM(A1)');
  });
});

describe('날짜당 1편 (불변식 1)', () => {
  it('같은 날짜에 새로 쓰면 CONFLICT, 시트는 그대로', () => {
    const gas = createReadyGas();
    ok(save(gas, { diaryDate: '2026-09-25', content: '처음' }));
    const e = err(save(gas, { diaryDate: '2026-09-25', content: '두 번째' }));
    expect(e.code).toBe('CONFLICT');
    expect(e.message).toContain('2026-09-25에는 이미 다이어리가 있습니다.');
    expect(gas.sheet('diaries').getLastRow()).toBe(2);
  });

  it('수정으로 이미 다이어리가 있는 날짜로 옮기면 CONFLICT, 같은 날짜 유지·빈 날짜로 이동은 가능', () => {
    const gas = createReadyGas();
    const a = ok(save(gas, { diaryDate: '2026-09-24', content: 'A' }));
    ok(save(gas, { diaryDate: '2026-09-25', content: 'B' }));
    gas.setNow('2026-09-25T10:00:00+09:00');
    expect(err(save(gas, { id: a.id, updatedAt: a.updatedAt, diaryDate: '2026-09-25', content: 'A' })).code).toBe('CONFLICT');
    const same = ok(save(gas, { id: a.id, updatedAt: a.updatedAt, diaryDate: '2026-09-24', title: '수정', content: 'A2' }));
    expect(same).toMatchObject({ id: a.id, title: '수정', content: 'A2', createdAt: a.createdAt });
    gas.setNow('2026-09-25T11:00:00+09:00');
    const moved = ok(save(gas, { id: a.id, updatedAt: same.updatedAt, diaryDate: '2026-09-23', title: '수정', content: 'A2' }));
    expect(moved.diaryDate).toBe('2026-09-23');
  });

  it('삭제한 날짜에는 다시 새로 쓸 수 있다', () => {
    const gas = createReadyGas();
    const d = ok(save(gas, { diaryDate: '2026-09-25', content: '지울 글' }));
    expect(ok(gas.call<ApiResult<{ id: string }>>('apiDeleteDiary', { id: d.id, updatedAt: d.updatedAt }))).toMatchObject({ id: d.id });
    expect(range(gas, '2026-09-25', '2026-09-25')).toEqual([]);
    expect(ok(save(gas, { diaryDate: '2026-09-25', content: '다시 씀' })).content).toBe('다시 씀');
    expect(gas.sheet('diaries').rawRow(2)[6]).toBe('TRUE'); // 논리 삭제
  });
});

describe('수정·삭제 잠금', () => {
  it('다른 곳에서 먼저 고쳤으면 CONFLICT, 삭제된 다이어리는 NOT_FOUND', () => {
    const gas = createReadyGas();
    const d = ok(save(gas, { diaryDate: '2026-09-25', content: 'v1' }));
    gas.setNow('2026-09-25T10:00:00+09:00');
    ok(save(gas, { id: d.id, updatedAt: d.updatedAt, diaryDate: d.diaryDate, content: 'v2' }));
    expect(err(save(gas, { id: d.id, updatedAt: d.updatedAt, diaryDate: d.diaryDate, content: 'v3' })).code).toBe('CONFLICT');
    expect(err(gas.call('apiDeleteDiary', { id: d.id, updatedAt: d.updatedAt })).code).toBe('CONFLICT');
    expect(err(save(gas, { id: d.id, diaryDate: d.diaryDate, content: 'x' })).code).toBe('VALIDATION'); // updatedAt 없음
    const [cur] = range(gas, '2026-09-25', '2026-09-25');
    ok(gas.call('apiDeleteDiary', { id: cur.id, updatedAt: cur.updatedAt }));
    expect(err(save(gas, { id: cur.id, updatedAt: cur.updatedAt, diaryDate: cur.diaryDate, content: 'x' })).code).toBe('NOT_FOUND');
  });
});

describe('조회·검색', () => {
  it('주 범위 조회는 날짜순, apiGetRange에도 포함', () => {
    const gas = createReadyGas();
    for (const [d, c] of [['2026-09-27', '일'], ['2026-09-21', '월'], ['2026-09-28', '다음 주']]) ok(save(gas, { diaryDate: d, content: c }));
    expect(range(gas, '2026-09-21', '2026-09-27').map((d) => d.content)).toEqual(['월', '일']);
    const r = ok(gas.call<ApiResult<{ diaries: Diary[] }>>('apiGetRange', { from: '2026-09-27', to: '2026-10-31' }));
    expect(r.diaries.map((d) => d.diaryDate)).toEqual(['2026-09-27', '2026-09-28']);
    expect(err(gas.call('apiGetDiaries', { from: '2026-01-01', to: '2026-12-31' })).code).toBe('VALIDATION');
  });

  it('검색: 타이틀·내용, 대소문자 무시, 최신 날짜순, 삭제 제외', () => {
    const gas = createReadyGas();
    ok(save(gas, { diaryDate: '2026-09-20', title: 'Coffee', content: '카페' }));
    ok(save(gas, { diaryDate: '2026-09-22', content: '아침에 coffee 한 잔' }));
    const gone = ok(save(gas, { diaryDate: '2026-09-23', content: 'COFFEE 또' }));
    ok(save(gas, { diaryDate: '2026-09-24', content: '차' }));
    ok(gas.call('apiDeleteDiary', { id: gone.id, updatedAt: gone.updatedAt }));
    const r = search(gas, 'CoFfEe');
    expect(r.diaries.map((d) => d.diaryDate)).toEqual(['2026-09-22', '2026-09-20']);
    expect(r.truncated).toBe(false);
    expect(err(gas.call('apiSearchDiaries', { keyword: ' ' })).message).toBe('검색어를 입력해 주세요.');
  });

  it('검색 결과는 최대 100건, 넘으면 truncated', () => {
    const gas = createReadyGas();
    let day = '2026-01-01';
    for (let i = 0; i < 101; i++) {
      ok(save(gas, { diaryDate: day, content: '반복 ' + i }));
      day = gas.eval(`addDaysYmd_('${day}', 1)`) as string;
    }
    const r = search(gas, '반복');
    expect(r.diaries).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(r.diaries[0].content).toBe('반복 100');
  });

  it('시트를 손으로 고쳐 타이틀이 비면 날짜 문구로 읽는다', () => {
    const gas = createReadyGas();
    ok(save(gas, { diaryDate: '2026-09-25', title: '원래', content: 'c' }));
    gas.sheet('diaries').cells.set('2:3', '');
    expect(range(gas, '2026-09-25', '2026-09-25')[0].title).toBe('2026년 9월 25일 (금)');
  });
});

describe('setup 전·마이그레이션 (불변식 4)', () => {
  function withoutDiarySheet() {
    const gas = createReadyGas();
    gas.spreadsheet().deleteSheet(gas.sheet('diaries'));
    return gas;
  }

  it('diaries 시트가 없어도 캘린더 조회·다이어리 조회·검색은 빈 목록, 저장은 setup 안내', () => {
    const gas = withoutDiarySheet();
    const r = ok(gas.call<ApiResult<{ diaries: Diary[]; worklogs: unknown[] }>>('apiGetRange', { from: '2026-09-01', to: '2026-09-30' }));
    expect(r.diaries).toEqual([]);
    expect(range(gas, '2026-09-21', '2026-09-27')).toEqual([]);
    expect(search(gas, '아무거나').diaries).toEqual([]);
    const e = err(save(gas, { diaryDate: '2026-09-25', content: 'c' }));
    expect(e).toMatchObject({ code: 'NOT_INITIALIZED', message: 'diaries 시트가 없습니다. setup을 다시 실행해 주세요.' });
  });

  it('기존 DB에 setup을 다시 실행하면 diaries 시트만 생성, 자가 점검 통과', () => {
    const gas = withoutDiarySheet();
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-25', title: '기존 기록' }));
    const before = gas.sheet('worklogs').rawRow(2);
    const report = gas.call<string>('setup');
    expect(report).toContain('[OK] 시트 생성: diaries');
    expect(gas.sheet('diaries').rawRow(1)).toEqual(gas.eval('SHEETS.DIARIES.columns.slice()'));
    expect(gas.sheet('worklogs').rawRow(2)).toEqual(before);
    expect(gas.call<string>('runSelfTest')).not.toContain('[FAIL]');
    expect(ok(save(gas, { diaryDate: '2026-09-25', content: 'setup 후 저장' })).title).toBe('2026년 9월 25일 (금)');
  });

  it('소유자가 아니면 다이어리 API도 FORBIDDEN', () => {
    const gas = createReadyGas();
    gas.state.activeEmail = 'someone@example.com';
    for (const [fn, arg] of [
      ['apiGetDiaries', { from: '2026-09-21', to: '2026-09-27' }],
      ['apiSaveDiary', { diaryDate: '2026-09-25', content: 'c' }],
      ['apiDeleteDiary', { id: 'x', updatedAt: 'y' }],
      ['apiSearchDiaries', { keyword: 'c' }],
    ] as const) {
      expect(err(gas.call(fn, arg)).code).toBe('FORBIDDEN');
    }
  });
});

/**
 * 화면 다국어 (v1.13). 설계: docs/design/i18n.md
 * 기존 테스트는 한국어 브라우저(tests/setup-i18n.ts)로 돌고, 여기서 일본어·언어 결정 규칙을 본다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Schedule, Worklog } from '../../src/api/types';
import { lang, langFromList, resolveLang, screenLang, setLang } from '../../src/i18n';
import ko from '../../src/i18n/ko';
import ja from '../../src/i18n/ja';
import { formatDateLabel, formatDateRange, scheduleDateText, timeLabel } from '../../src/utils/date';
import { diaryDefaultTitle, diaryWeekLabel, isDefaultDiaryTitle } from '../../src/utils/diary';
import { backupSpanLabel, logTimeLabel, notifyLogLine, triggerStatus } from '../../src/utils/notifyLog';
import { periodText, searchPeriodError } from '../../src/utils/searchPeriod';
import { mergeTrash, trashKindLabel } from '../../src/utils/trash';
import { buildWeeklyReport, reportWeekLabel } from '../../src/utils/weeklyReport';
import { periodError, periodLabel } from '../../src/utils/worklog';
import { validateTags } from '../../src/utils/tags';

describe('언어 결정 규칙', () => {
  it('설정이 ko·ja면 그 값', () => {
    expect(resolveLang('ko', ['ja-JP'])).toBe('ko');
    expect(resolveLang('ja', ['ko-KR'])).toBe('ja');
  });

  it('자동이면 브라우저 언어 목록에서 앞쪽의 한국어·일본어, 둘 다 없으면 일본어', () => {
    expect(resolveLang('auto', ['ko-KR', 'ja'])).toBe('ko');
    expect(resolveLang('auto', ['ja-JP', 'ko'])).toBe('ja');
    expect(resolveLang('auto', ['en-US', 'ko'])).toBe('ko');
    expect(resolveLang('auto', ['en-US'])).toBe('ja');
    expect(resolveLang('auto', [])).toBe('ja');
    expect(resolveLang('auto', undefined)).toBe('ja');
    expect(langFromList(['KO'])).toBe('ko');
  });

  it('이상한 설정 값은 자동으로 본다', () => {
    expect(resolveLang('fr', ['ko-KR'])).toBe('ko');
    expect(resolveLang(undefined, ['ja'])).toBe('ja');
  });

  it('주 언어 코드 단위로 본다 (kok·jam은 아님)', () => {
    expect(langFromList(['kok-IN', 'ko'])).toBe('ko');
    expect(langFromList(['jam'])).toBe('ja'); // 맞는 것이 없어 기본값
    expect(langFromList(['jam', 'ko_KR'])).toBe('ko');
  });

  it('화면 언어(screenLang)는 서버에 보내는 브라우저 언어와 같은 판정 — languages가 비면 language로', () => {
    const saved = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'ko-KR', languages: [] }, configurable: true });
    try {
      expect(screenLang('auto')).toBe('ko');
      expect(screenLang('ja')).toBe('ja');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: saved, configurable: true });
    }
  });
});

describe('사전', () => {
  /** 사전 모양: 키 경로 → 'string' | 'fn<인자 수>' | 'arr<길이>' */
  function shape(obj: unknown, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix + k;
      if (typeof v === 'function') out[key] = 'fn' + v.length;
      else if (Array.isArray(v)) out[key] = 'arr' + v.length;
      else if (v && typeof v === 'object') Object.assign(out, shape(v, key + '.'));
      else out[key] = typeof v;
    }
    return out;
  }
  /** 모든 값을 문자열로 (함수는 샘플 인자로 불러서) */
  function values(obj: unknown): string[] {
    return Object.values(obj as Record<string, unknown>).flatMap((v) => {
      if (typeof v === 'function') return [String((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, (_, i) => (i === 0 ? 'SCHEDULE' : 1))))];
      if (Array.isArray(v)) return v.map(String);
      if (v && typeof v === 'object') return values(v);
      return [String(v)];
    });
  }

  it('일본어 사전은 한국어 사전과 키·인자 개수가 같다 (타입 체크에 더해 실행 시에도 확인)', () => {
    expect(shape(ja)).toEqual(shape(ko));
  });

  it('일본어 사전에 한글이 없고, 비어 있는 값이 없다 (일부러 빈 문장 구분자 하나만 예외)', () => {
    const { common: { sentenceSep, ...jaCommon }, ...jaRest } = ja;
    expect(sentenceSep).toBe(''); // 일본어는 문장을 띄어 쓰지 않고 잇는다
    const list = values({ ...jaRest, common: jaCommon });
    expect(list.filter((v) => /[가-힣]/.test(v))).toEqual([]);
    expect(list.filter((v) => v === '')).toEqual([]);
    expect(values(ko).filter((v) => v === '')).toEqual([]);
  });
});

describe('일본어 표기', () => {
  beforeEach(() => setLang('ja'));
  afterEach(() => setLang('ko'));

  it('날짜·요일·종일', () => {
    expect(formatDateLabel('2026-09-24')).toBe('9月24日(木)');
    expect(diaryDefaultTitle('2026-09-25')).toBe('2026年9月25日(金)');
    expect(diaryWeekLabel('2026-09-28')).toBe('2026年9月28日〜10月4日');
    expect(formatDateRange('2026-12-28', '2027-01-01', true)).toBe('2026年12月28日(月)〜2027年1月1日(金)');
    expect(reportWeekLabel('2026-09-21')).toBe('2026年9月21日(月)〜25日(金)');
    const allDay = { startAt: '2026-09-24T00:00', endAt: '2026-09-24T00:00', allDay: true };
    expect(timeLabel(allDay)).toBe('終日');
    expect(scheduleDateText(allDay)).toBe('9/24(木)');
    expect(scheduleDateText({ startAt: '2026-09-22T10:00', endAt: '2026-09-22T11:00', allDay: false })).toBe('9/22(火) 10:00');
  });

  it('검색 기간·기간 기록·태그 문구', () => {
    expect(periodText({ from: '2026-09-01', to: '' })).toBe('2026-09-01以降');
    expect(periodText({ from: '', to: '2026-09-30' })).toBe('2026-09-30まで');
    expect(periodText({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09-01〜2026-09-30');
    expect(searchPeriodError({ from: '2026-09-30', to: '2026-09-01' })).toBe('検索終了日は検索開始日以降にしてください。');
    expect(periodLabel({ workDate: '2026-09-21', endDate: '2026-09-25' })).toBe('9/21〜9/25・5日間');
    expect(timeLabel({ startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:30', allDay: false })).toBe('10:00〜11:30');
    expect(periodError('2026-09-21', '2026-09-21', 92)).toContain('「1日の記録」タブ');
    expect(validateTags(['a', 'b'], { tagCount: 1, tagLength: 30 })).toBe('タグは最大1個まで使用できます。');
  });

  it('설정 화면 기록 문구', () => {
    expect(logTimeLabel('2026-09-25T07:12:03.120+09:00')).toBe('9/25(金) 07:12');
    expect(notifyLogLine({ loggedAt: '2026-09-23T07:06:00+09:00', kind: 'DIGEST', targetDate: '2026-09-23', result: 'SKIPPED_HOLIDAY', detail: '秋分の日' }))
      .toMatchObject({ label: '朝のメール', text: '祝日のため休み(秋分の日)', tone: 'skip' });
    expect(notifyLogLine({ loggedAt: '2026-09-24T07:06:00+09:00', kind: 'DIGEST', targetDate: '2026-09-24', result: 'SKIPPED_DUPLICATE', detail: '' }).text)
      .toBe('送信済みのためスキップ');
    expect(triggerStatus(2)).toEqual({ ok: false, text: '重複 2件' });
    expect(backupSpanLabel(8)).toBe('約2か月分');
  });

  it('휴지통 종류·다이어리 날짜', () => {
    expect(trashKindLabel('DIARY')).toBe('日記');
    const [e] = mergeTrash({ schedules: [], worklogs: [], diaries: [{ id: 'd1', diaryDate: '2026-09-24', title: 't', content: '', createdAt: '', updatedAt: 'x' }] });
    expect(e.when).toBe('9/24(木)');
  });

  it('주간 보고 글', () => {
    const W = (p: Partial<Worklog>): Worklog => ({
      id: 'w', workDate: '2026-09-22', endDate: '', title: '作業', content: '', projectId: '', scheduleId: '', tags: [], status: 'DONE', createdAt: '', updatedAt: '', ...p,
    });
    const S = (p: Partial<Schedule>): Schedule => ({
      id: 's', type: 'TASK', title: '来週の作業', description: '', allDay: false, startAt: '2026-09-29T10:00', endAt: '2026-09-29T11:00',
      priority: 'MEDIUM', projectId: '', location: '', status: 'PLANNED', tags: [], createdAt: '', updatedAt: '', ...p,
    });
    const r = buildWeeklyReport({ worklogs: [W({})], schedules: [S({})] }, [], '2026-09-21', '2026-09-23');
    expect(r.text.split('\n')).toEqual([
      '[週報] 2026年9月21日(月)〜25日(金)',
      '',
      '■ 完了した作業(1件)',
      '[その他]',
      '- 作業',
      '',
      '■ 進行中の作業(0件)',
      '- なし',
      '',
      '■ 未完了の予定(0件)',
      '- なし',
      '',
      '■ 来週の予定 9/28〜10/2(1件)',
      '[その他]',
      '- 来週の作業（9/29(火) 10:00）',
    ]);
  });
});

describe('다이어리 기본 제목 알아보기 (다른 언어로 저장한 것도)', () => {
  it('한국어·일본어 기본 제목 모두 기본 제목으로 본다', () => {
    setLang('ja');
    try {
      expect(isDefaultDiaryTitle('2026년 9월 24일 (목)', '2026-09-24')).toBe(true);
      expect(isDefaultDiaryTitle('2026年9月24日(木)', '2026-09-24')).toBe(true);
      expect(isDefaultDiaryTitle('2026年9月24日(木)', '2026-09-25')).toBe(false);
      expect(isDefaultDiaryTitle('雨の日', '2026-09-24')).toBe(false);
      expect(diaryDefaultTitle('2026-09-24', 'ko')).toBe('2026년 9월 24일 (목)');
    } finally {
      setLang('ko');
    }
  });
});

describe('한국어 표기는 그대로 (회귀)', () => {
  it('언어를 바꿨다 돌아와도 같은 문구', () => {
    setLang('ja');
    setLang('ko');
    expect(lang.value).toBe('ko');
    expect(formatDateLabel('2026-09-24')).toBe('9월 24일 (목)');
    expect(reportWeekLabel('2026-09-28')).toBe('2026년 9월 28일 (월) ~ 10월 2일 (금)');
    expect(scheduleDateText({ startAt: '2026-09-22T10:00', endAt: '2026-09-22T11:00', allDay: false })).toBe('9/22 화 10:00');
  });
});

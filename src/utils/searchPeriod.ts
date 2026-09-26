/**
 * 상단 검색(작업기록·일정)의 기간 필터. 설계: docs/design/search-period.md
 * 기간은 { from, to } 문자열이고 ''는 "제한 없음"이다 (서버 apiSearch의 from?/to?와 같은 뜻).
 */
import { msgs } from '../i18n';
import { addDays, addMonthsClamped, isYmd, monthRange } from './date';

export type SearchPeriodKind = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_3_MONTHS' | 'THIS_YEAR' | 'CUSTOM';

/** 빠른 선택 버튼 순서. 이름은 사전 searchPeriod[kind] */
export const SEARCH_PERIOD_OPTIONS: ReadonlyArray<{ kind: SearchPeriodKind }> = [
  { kind: 'ALL' },
  { kind: 'THIS_MONTH' },
  { kind: 'LAST_MONTH' },
  { kind: 'LAST_3_MONTHS' },
  { kind: 'THIS_YEAR' },
  { kind: 'CUSTOM' },
];

export interface DateRange {
  from: string;
  to: string;
}

/** 빠른 선택 → 실제 기간. CUSTOM이면 입력값 그대로 (한쪽만 있어도 됨) */
export function periodRange(kind: SearchPeriodKind, today: string, custom: DateRange = { from: '', to: '' }): DateRange {
  switch (kind) {
    case 'THIS_MONTH': {
      const r = monthRange(today);
      return { from: r.start, to: r.end };
    }
    case 'LAST_MONTH': {
      const r = monthRange(addDays(monthRange(today).start, -1));
      return { from: r.start, to: r.end };
    }
    case 'LAST_3_MONTHS':
      return { from: addMonthsClamped(today, -3), to: today };
    case 'THIS_YEAR':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'CUSTOM':
      return { from: custom.from, to: custom.to };
    default:
      return { from: '', to: '' };
  }
}

/** 기간 입력 검사 (서버와 같은 문구). 문제가 없으면 '' */
export function searchPeriodError(range: DateRange): string {
  const t = msgs().search;
  if (range.from && !isYmd(range.from)) return t.checkFrom;
  if (range.to && !isYmd(range.to)) return t.checkTo;
  if (range.from && range.to && range.to < range.from) return t.rangeOrder;
  return '';
}

/** 결과 위에 보여 줄 문구. 제한이 없으면 '' */
export function periodText(range: DateRange): string {
  if (!range.from && !range.to) return '';
  return msgs().search.periodText(range.from, range.to);
}

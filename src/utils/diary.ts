/**
 * 다이어리 화면 계산. 주는 월요일~일요일 (기간 기록의 주 계산과 같은 월요일 시작).
 * 기본 타이틀 형식은 서버(gas/45_DiaryService.js diaryDefaultTitle_)와 같다.
 */
import { lang as currentLang, LANGS, msgsOf, type Lang } from '../i18n';
import { addDays, dayOfWeek, formatDateRange, mondayOf } from './date';

/** '2026-09-25' → '2026년 9월 25일 (금)' / '2026年9月25日(金)' (기본은 화면 언어) */
export function diaryDefaultTitle(ymd: string, l: Lang = currentLang.value): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = msgsOf(l).date;
  return t.withWd(t.ymd(y, m, d), t.weekdays[dayOfWeek(ymd)]);
}

/** 제목이 그 날짜의 기본 제목(어느 언어든)인지 — 다른 언어 화면에서 저장한 다이어리도 알아본다 */
export function isDefaultDiaryTitle(title: string, ymd: string): boolean {
  return LANGS.some((l) => title === diaryDefaultTitle(ymd, l));
}

/** 기준일이 속한 주의 월~일 7일 */
export function weekDays(base: string): string[] {
  const monday = mondayOf(base);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 주 제목: '2026년 9월 21일 ~ 27일', 달이 바뀌면 '2026년 9월 28일 ~ 10월 4일', 해가 바뀌면 '2026년 12월 28일 ~ 2027년 1월 3일' */
export function diaryWeekLabel(weekStart: string): string {
  return formatDateRange(weekStart, addDays(weekStart, 6));
}

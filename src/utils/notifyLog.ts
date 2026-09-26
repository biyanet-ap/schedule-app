/**
 * 설정 화면의 '최근 기록' 한 줄 문구 (v1.12). 설계: docs/design/settings.md
 * notify_log의 kind·result를 사람이 읽는 말로 바꾼다 (순수 함수).
 */
import type { NotifyLogRow } from '../api/types';
import { msgs } from '../i18n';
import { formatShortDate, isYmd, weekdayOf } from './date';

export type LogTone = 'ok' | 'skip' | 'fail';

export interface LogLine {
  /** '9/25 (목) 07:12' */
  when: string;
  /** '아침 메일' / '테스트 메일' / '백업' */
  label: string;
  /** '보냄' / '공휴일이라 쉼 (秋分の日)' / '실패: …' */
  text: string;
  tone: LogTone;
}


/** 서버 시각('2026-09-25T07:12:03.120+09:00', JST 표기) → '9/25 (목) 07:12'. 형식이 아니면 그대로 */
export function logTimeLabel(stamp: string): string {
  const m = /^(\d{4}-(\d{2})-(\d{2}))T(\d{2}):(\d{2})/.exec(stamp);
  if (!m || !isYmd(m[1])) return stamp;
  return `${msgs().date.withWd(formatShortDate(m[1]), weekdayOf(m[1]))} ${m[4]}:${m[5]}`;
}

export function notifyLogLine(r: NotifyLogRow): LogLine {
  const t = msgs().notifyLog;
  const base = (t.results as Record<string, string>)[r.result] ?? r.result;
  let text = base;
  if (r.detail && r.result === 'SKIPPED_HOLIDAY') text = t.withHoliday(base, r.detail);
  else if (r.detail && r.result === 'FAILED') text = `${base}: ${r.detail}`;
  const tone: LogTone = r.result === 'FAILED' ? 'fail' : r.result.startsWith('SKIPPED_') ? 'skip' : 'ok';
  return { when: logTimeLabel(r.loggedAt), label: (t.kinds as Record<string, string>)[r.kind] ?? r.kind, text, tone };
}

/** 예약 개수 → 상태 문구 (정상 = 1개) */
export function triggerStatus(count: number): { ok: boolean; text: string } {
  const t = msgs().notifyLog;
  if (count === 1) return { ok: true, text: t.triggerOk };
  if (count === 0) return { ok: false, text: t.triggerNone };
  return { ok: false, text: t.triggerDup(count) };
}

/** 백업 보관 개수 → '약 N주치' (매주 1개) */
export function backupSpanLabel(keep: number): string {
  const t = msgs().notifyLog;
  if (keep >= 52) return t.spanYears(Math.round((keep / 52) * 10) / 10);
  if (keep >= 8) return t.spanMonths(Math.round(keep / 4.3));
  return t.spanWeeks(keep);
}

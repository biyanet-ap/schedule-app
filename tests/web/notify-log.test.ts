import { describe, expect, it } from 'vitest';
import type { NotifyLogRow } from '../../src/api/types';
import { backupSpanLabel, logTimeLabel, notifyLogLine, triggerStatus } from '../../src/utils/notifyLog';

const R = (p: Partial<NotifyLogRow>): NotifyLogRow => ({ loggedAt: '2026-09-25T07:12:03.120+09:00', kind: 'DIGEST', targetDate: '2026-09-25', result: 'SENT', detail: '', ...p });

describe('최근 기록 문구', () => {
  it('시각: 9/25 (금) 07:12, 형식이 아니면 그대로', () => {
    expect(logTimeLabel('2026-09-25T07:12:03.120+09:00')).toBe('9/25 (금) 07:12');
    expect(logTimeLabel('어제')).toBe('어제');
  });

  it('아침 메일 결과별 문구와 색', () => {
    const t = (result: string, detail = '') => {
      const l = notifyLogLine(R({ result, detail }));
      return [l.label, l.text, l.tone];
    };
    expect(t('SENT')).toEqual(['아침 메일', '보냄', 'ok']);
    expect(t('SKIPPED_WEEKEND')).toEqual(['아침 메일', '주말이라 쉼', 'skip']);
    expect(t('SKIPPED_HOLIDAY', '秋分の日')).toEqual(['아침 메일', '공휴일이라 쉼 (秋分の日)', 'skip']);
    expect(t('SKIPPED_DISABLED')[1]).toBe('메일 꺼짐');
    expect(t('SKIPPED_EMPTY')[1]).toBe('보낼 내용 없음');
    expect(t('SKIPPED_DUPLICATE')[1]).toBe('이미 보냄');
    expect(t('FAILED', 'quota')).toEqual(['아침 메일', '실패: quota', 'fail']);
    expect(t('FAILED')).toEqual(['아침 메일', '실패', 'fail']);
  });

  it('테스트 메일·백업·모르는 값', () => {
    expect(notifyLogLine(R({ kind: 'DIGEST_TEST' }))).toMatchObject({ label: '테스트 메일', text: '보냄', tone: 'ok' });
    expect(notifyLogLine(R({ kind: 'BACKUP', result: 'OK' }))).toMatchObject({ label: '백업', text: '완료', tone: 'ok' });
    expect(notifyLogLine(R({ kind: 'BACKUP', result: 'FAILED', detail: 'drive' }))).toMatchObject({ text: '실패: drive', tone: 'fail' });
    expect(notifyLogLine(R({ kind: 'OTHER', result: 'WHATEVER' }))).toMatchObject({ label: 'OTHER', text: 'WHATEVER', tone: 'ok' });
  });
});

describe('예약 상태·백업 기간', () => {
  it('예약 개수 → 정상 / 없음 / 중복', () => {
    expect(triggerStatus(1)).toEqual({ ok: true, text: '정상' });
    expect(triggerStatus(0)).toEqual({ ok: false, text: '없음' });
    expect(triggerStatus(3)).toEqual({ ok: false, text: '중복 3개' });
  });

  it('보관 개수 → 기간 문구', () => {
    expect(backupSpanLabel(4)).toBe('4주치');
    expect(backupSpanLabel(8)).toBe('약 2개월치');
    expect(backupSpanLabel(26)).toBe('약 6개월치');
    expect(backupSpanLabel(52)).toBe('약 1년치');
    expect(backupSpanLabel(100)).toBe('약 1.9년치');
  });
});

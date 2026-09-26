import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, OWNER, type ApiResult, type Gas } from './harness';

interface Settings { notifyEnabled: boolean; skipHolidays: boolean; notifyWhenEmpty: boolean; todayPopup: boolean; digestHour: number; backupKeep: number; language: string }
interface LogRow { loggedAt: string; kind: string; targetDate: string; result: string; detail: string }
interface View {
  settings: Settings; updatedAt: string; digestHours: number[]; limits: { backupKeepMax: number; testMailPerDay: number };
  triggers: { digest: number; backup: number }; recentLog: LogRow[]; digestTriggerReplaced?: boolean;
}

const view = (gas: Gas) => ok(gas.call<ApiResult<View>>('apiGetSettings'));
const save = (gas: Gas, input: Record<string, unknown>) => gas.call<ApiResult<View>>('apiSaveSettings', input);
const DEFAULTS: Settings = { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, language: 'auto' };
const digestTriggers = (gas: Gas) => gas.state.triggers.filter((t) => t.handler === 'sendMorningDigest');
/** 시트의 key → value */
const sheetValue = (gas: Gas, key: string) => {
  const s = gas.sheet('settings');
  for (let r = 2; r <= s.getLastRow(); r++) if (s.rawRow(r)[0] === key) return s.rawRow(r)[1];
  return undefined;
};

describe('설정 읽기', () => {
  it('setup 직후: 기본값, 잠금 값 없음, 고를 수 있는 시각, 예약 개수', () => {
    const gas = createReadyGas();
    const v = view(gas);
    expect(v.settings).toEqual(DEFAULTS);
    expect(v.updatedAt).toBe('');
    expect(v.digestHours).toEqual([5, 6, 7, 8, 9, 10]);
    expect(v.limits).toEqual({ backupKeepMax: 100, testMailPerDay: 5 });
    expect(v.triggers).toEqual({ digest: 1, backup: 1 });
  });

  it('시트를 손으로 잘못 고친 값은 기본값으로 읽는다 (시각·보관 개수)', () => {
    const gas = createReadyGas();
    const s = gas.sheet('settings');
    for (let r = 2; r <= s.getLastRow(); r++) {
      if (s.rawRow(r)[0] === 'digest_hour') s.write(r, 2, '13');
      if (s.rawRow(r)[0] === 'backup_keep') s.write(r, 2, '0');
      if (s.rawRow(r)[0] === 'notify_enabled') s.write(r, 2, 'false');
    }
    expect(view(gas).settings).toMatchObject({ digestHour: 7, backupKeep: 8, notifyEnabled: false });
  });

  it('v1.11 이전 시트 (새 키 없음): 기본값으로 동작', () => {
    const gas = createReadyGas();
    const s = gas.sheet('settings');
    for (let r = 2; r <= s.getLastRow(); r++) {
      if (s.rawRow(r)[0] === 'digest_hour' || s.rawRow(r)[0] === 'today_popup') { s.write(r, 1, ''); s.write(r, 2, ''); }
    }
    expect(view(gas).settings).toMatchObject({ digestHour: 7, todayPopup: true });
  });
});

describe('설정 저장', () => {
  it('저장하면 시트에 쓰고 잠금 값을 준다. 시각이 같으면 예약을 건드리지 않는다', () => {
    const gas = createReadyGas();
    const before = digestTriggers(gas)[0];
    gas.setNow('2026-09-24T10:00:00+09:00');
    const v = ok(save(gas, { ...DEFAULTS, notifyEnabled: false, skipHolidays: false, notifyWhenEmpty: false, todayPopup: false, backupKeep: 12, updatedAt: '' }));
    expect(v.settings).toEqual({ ...DEFAULTS, notifyEnabled: false, skipHolidays: false, notifyWhenEmpty: false, todayPopup: false, backupKeep: 12 });
    expect(v.updatedAt).toBe('2026-09-24T10:00:00.000+09:00');
    expect(v.digestTriggerReplaced).toBe(false);
    expect(digestTriggers(gas)).toEqual([before]);
    expect([sheetValue(gas, 'notify_enabled'), sheetValue(gas, 'today_popup'), sheetValue(gas, 'backup_keep')]).toEqual(['FALSE', 'FALSE', '12']);
    // 다른 기능이 새 값을 쓴다
    expect(ok(gas.call<ApiResult<{ settings: { todayPopup: boolean } }>>('apiBootstrap')).settings.todayPopup).toBe(false);
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_DISABLED');
  });

  it('발송 시각을 바꾸면 예약을 새 시각으로 다시 건다 (1개만 남음, 백업 예약은 그대로)', () => {
    const gas = createReadyGas();
    const backup = gas.state.triggers.find((t) => t.handler === 'weeklyBackup');
    const v = ok(save(gas, { ...DEFAULTS, digestHour: 9, updatedAt: '' }));
    expect(v.digestTriggerReplaced).toBe(true);
    expect(v.settings.digestHour).toBe(9);
    expect(digestTriggers(gas).map((t) => t.config)).toEqual([{ atHour: 9, everyDays: 1, timezone: 'Asia/Tokyo' }]);
    expect(gas.state.triggers.find((t) => t.handler === 'weeklyBackup')).toBe(backup);
    expect(v.triggers).toEqual({ digest: 1, backup: 1 });
    expect(sheetValue(gas, 'digest_hour')).toBe('9');
  });

  it('예약 교체는 새 것을 먼저 만든다 (만드는 도중 실패하면 옛 예약이 남는다)', () => {
    const gas = createReadyGas();
    gas.eval('createDigestTrigger_ = function () { throw new Error("trigger quota"); };');
    const e = err(save(gas, { ...DEFAULTS, digestHour: 8, updatedAt: '' }));
    expect(e.code).toBe('INTERNAL');
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([7]);
    expect(sheetValue(gas, 'digest_hour')).toBe('7');
  });

  it('시트 저장이 도중에 실패하면 시트의 시각과 예약을 모두 원래대로 되돌린다', () => {
    const gas = createReadyGas();
    // digest_hour까지 쓴 뒤 마지막 키(settings_updated_at, 새 행)에서 실패
    gas.eval(`(function () { var orig = insertRow_; insertRow_ = function (def, obj) {
      if (obj && obj.key === 'settings_updated_at') throw new Error('sheet write failed');
      return orig(def, obj); }; })()`);
    const e = err(save(gas, { ...DEFAULTS, digestHour: 10, updatedAt: '' }));
    expect(e).toEqual({ code: 'INTERNAL', message: '설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    expect(sheetValue(gas, 'digest_hour')).toBe('7');
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([7]);
  });

  it('되돌리기까지 실패하면 다시 걸기를 안내한다', () => {
    const gas = createReadyGas();
    gas.eval('writeSettings_ = function () { throw new Error("sheet down"); };');
    const e = err(save(gas, { ...DEFAULTS, digestHour: 10, updatedAt: '' }));
    expect(e.code).toBe('INTERNAL');
    expect(e.message).toContain("'다시 걸기'를 눌러 주세요");
    // 예약은 원래 시각으로는 돌아가 있다
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([7]);
  });

  it('옛 예약을 지우다 실패해도 결국 원래 시각 1개로 맞춘다', () => {
    const gas = createReadyGas();
    gas.eval(`(function () { var orig = ScriptApp.deleteTrigger, once = true;
      ScriptApp.deleteTrigger = function (t) { if (once) { once = false; throw new Error('delete failed'); } return orig(t); }; })()`);
    expect(err(save(gas, { ...DEFAULTS, digestHour: 9, updatedAt: '' })).code).toBe('INTERNAL');
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([7]);
    expect(sheetValue(gas, 'digest_hour')).toBe('7');
  });

  it('잠금: 다른 곳에서 먼저 저장했으면 CONFLICT, 시트·예약은 그대로', () => {
    const gas = createReadyGas();
    const first = ok(save(gas, { ...DEFAULTS, backupKeep: 10, updatedAt: '' }));
    const e = err(save(gas, { ...DEFAULTS, digestHour: 6, updatedAt: '' })); // 오래된 화면
    expect(e).toEqual({ code: 'CONFLICT', message: '다른 곳에서 먼저 바뀐 설정입니다. 새로고침 후 다시 시도해 주세요.' });
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([7]);
    gas.setNow('2026-09-24T11:00:00+09:00');
    expect(ok(save(gas, { ...DEFAULTS, digestHour: 6, updatedAt: first.updatedAt })).settings.digestHour).toBe(6);
  });

  it('입력 검증: 자료형·범위·필수, 모르는 필드는 무시', () => {
    const gas = createReadyGas();
    const bad = (patch: Record<string, unknown>) => err(save(gas, { ...DEFAULTS, updatedAt: '', ...patch }));
    expect(bad({ notifyEnabled: 'TRUE' }).message).toBe('아침 메일 보내기 값이 올바르지 않습니다.');
    expect(bad({ digestHour: 11 }).message).toBe('발송 시각은 5~10 사이의 정수여야 합니다.');
    expect(bad({ digestHour: 4 }).code).toBe('VALIDATION');
    expect(bad({ digestHour: 7.5 }).code).toBe('VALIDATION');
    expect(bad({ backupKeep: 0 }).message).toBe('백업 보관 개수는 1~100 사이의 정수여야 합니다.');
    expect(bad({ backupKeep: 101 }).code).toBe('VALIDATION');
    expect(bad({ backupKeep: null }).message).toBe('백업 보관 개수를 입력해 주세요.');
    // 숫자 자료형만 (true·'8'·[8]이 숫자로 바뀌어 저장되지 않게)
    expect(bad({ backupKeep: true }).code).toBe('VALIDATION');
    expect(bad({ backupKeep: '8' }).code).toBe('VALIDATION');
    expect(bad({ backupKeep: [12] }).code).toBe('VALIDATION');
    expect(bad({ digestHour: '0x8' }).message).toBe('발송 시각은 5~10 사이의 정수여야 합니다.');
    expect(bad({ updatedAt: undefined }).code).toBe('VALIDATION');
    expect(sheetValue(gas, 'settings_updated_at')).toBeUndefined();
    const v = ok(save(gas, { ...DEFAULTS, updatedAt: '', owner_email: 'x@example.com', extra: 1 }));
    expect(v.settings).toEqual(DEFAULTS);
    expect(sheetValue(gas, 'owner_email')).toBeUndefined();
  });

  it('같은 키가 여러 행이면 모두 같은 값으로 쓴다 (읽을 때 어느 행을 봐도 같게)', () => {
    const gas = createReadyGas();
    gas.eval("withLock_(function () { insertRow_(SHEETS.SETTINGS, { key: 'backup_keep', value: '30' }); })");
    ok(save(gas, { ...DEFAULTS, backupKeep: 5, updatedAt: '' }));
    const s = gas.sheet('settings');
    const values = [];
    for (let r = 2; r <= s.getLastRow(); r++) if (s.rawRow(r)[0] === 'backup_keep') values.push(s.rawRow(r)[1]);
    expect(values).toEqual(['5', '5']);
  });
});

describe('setup·예약 다시 걸기', () => {
  it('setup을 다시 실행해도 앱에서 고른 시각을 따른다', () => {
    const gas = createReadyGas();
    ok(save(gas, { ...DEFAULTS, digestHour: 5, updatedAt: '' }));
    gas.call('setup');
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([5]);
    expect(gas.state.triggers).toHaveLength(2);
  });

  it('예약이 빠지거나 중복되면 개수로 알 수 있고, 다시 걸면 각각 1개', () => {
    const gas = createReadyGas();
    gas.state.triggers = gas.state.triggers.filter((t) => t.handler !== 'sendMorningDigest');
    gas.state.triggers.push({ handler: 'weeklyBackup', config: {} });
    expect(view(gas).triggers).toEqual({ digest: 0, backup: 2 });
    ok(save(gas, { ...DEFAULTS, digestHour: 8, updatedAt: '' }));
    const v = ok(gas.call<ApiResult<View>>('apiRepairTriggers'));
    expect(v.triggers).toEqual({ digest: 1, backup: 1 });
    expect(digestTriggers(gas).map((t) => t.config.atHour)).toEqual([8]);
  });
});

describe('최근 기록', () => {
  it('최신 10건, 최신 순. 공휴일 이름·오류 문구만 보여 주고 내부 값은 숨긴다', () => {
    const gas = createReadyGas();
    gas.eval(`withLock_(function () {
      for (var i = 1; i <= 9; i++) appendNotifyLog_('DIGEST', '2026-09-0' + i, 'SENT', 'schedules=1');
      appendNotifyLog_('BACKUP', '2026-09-21', 'OK', 'copy=file-id-123, trashed=0, keep=8');
      appendNotifyLog_('DIGEST', '2026-09-22', 'SKIPPED_HOLIDAY', '秋分の日');
      appendNotifyLog_('DIGEST', '2026-09-23', 'FAILED', 'x'.repeat(300));
    })`);
    const log = view(gas).recentLog;
    expect(log).toHaveLength(10);
    expect(log.map((r) => r.result).slice(0, 3)).toEqual(['FAILED', 'SKIPPED_HOLIDAY', 'OK']);
    expect(log[0].detail).toHaveLength(200);
    expect(log[1].detail).toBe('秋分の日');
    expect(log[2]).toMatchObject({ kind: 'BACKUP', detail: '' });
    expect(log[9].targetDate).toBe('2026-09-03');
    expect(log[0].loggedAt).toMatch(/^2026-09-24T/);
  });
});

describe('테스트 메일', () => {
  it('소유자에게 [테스트] 제목으로 보내고, 설정·주말과 상관없이 보낸다. 오늘 아침 발송에는 영향 없음', () => {
    const gas = createReadyGas();
    ok(save(gas, { ...DEFAULTS, notifyEnabled: false, updatedAt: '' }));
    gas.setNow('2026-09-26T10:00:00+09:00'); // 토요일
    expect(ok(gas.call<ApiResult<{ sentToday: number }>>('apiSendTestDigest'))).toEqual({ sentToday: 1 });
    expect(gas.state.sentMails).toHaveLength(1);
    expect(gas.state.sentMails[0].to).toBe(OWNER);
    expect(gas.state.sentMails[0].subject).toMatch(/^\[테스트\] \[스케줄관리\] 9\/26\(토\)/);
    expect(view(gas).recentLog[0]).toMatchObject({ kind: 'DIGEST_TEST', result: 'SENT', targetDate: '2026-09-26' });

    // 평일 아침 발송은 테스트 메일과 별개로 판단
    ok(save(gas, { ...DEFAULTS, updatedAt: view(gas).updatedAt }));
    gas.setNow('2026-09-24T09:00:00+09:00');
    ok(gas.call('apiSendTestDigest'));
    expect(gas.call('sendMorningDigest')).toBe('SENT');
  });

  it('하루 5번까지', () => {
    const gas = createReadyGas();
    for (let i = 1; i <= 5; i++) expect(ok(gas.call<ApiResult<{ sentToday: number }>>('apiSendTestDigest')).sentToday).toBe(i);
    const e = err(gas.call('apiSendTestDigest'));
    expect(e).toEqual({ code: 'VALIDATION', message: '테스트 메일은 하루 5번까지 보낼 수 있습니다.' });
    expect(gas.state.sentMails).toHaveLength(5);
    gas.setNow('2026-09-25T07:30:00+09:00');
    expect(ok(gas.call<ApiResult<{ sentToday: number }>>('apiSendTestDigest')).sentToday).toBe(1);
  });

  it('발송 실패는 오류 문구와 함께 알리고 기록에 남긴다 (실패도 하루 한도에 센다)', () => {
    const gas = createReadyGas();
    gas.state.mailThrows = true;
    const e = err(gas.call('apiSendTestDigest'));
    expect(e.code).toBe('INTERNAL');
    expect(e.message).toBe('테스트 메일을 보내지 못했습니다: Service invoked too many times for one day: email.');
    expect(view(gas).recentLog[0]).toMatchObject({ kind: 'DIGEST_TEST', result: 'FAILED' });
    gas.state.mailThrows = false;
    expect(ok(gas.call<ApiResult<{ sentToday: number }>>('apiSendTestDigest')).sentToday).toBe(2);
    for (let i = 0; i < 3; i++) ok(gas.call('apiSendTestDigest'));
    expect(err(gas.call('apiSendTestDigest')).code).toBe('VALIDATION');
  });
});

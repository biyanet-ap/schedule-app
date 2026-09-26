/**
 * 다국어 (v1.13). 설계: docs/design/i18n.md
 */
import { describe, expect, it } from 'vitest';
import { createGas, createReadyGas, err, ok, type ApiResult, type Gas } from './harness';

const SETTINGS = { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8 };
const saveSettings = (gas: Gas, input: Record<string, unknown>, lang?: string) => {
  const cur = ok(gas.call<ApiResult<{ updatedAt: string }>>('apiGetSettings'));
  return gas.call<ApiResult<{ settings: { language: string } }>>('apiSaveSettings', { ...SETTINGS, updatedAt: cur.updatedAt, ...input }, lang);
};
const sheetValue = (gas: Gas, key: string) => {
  const s = gas.sheet('settings');
  for (let r = 2; r <= s.getLastRow(); r++) if (s.rawRow(r)[0] === key) return s.rawRow(r)[1];
  return undefined;
};

describe('서버 사전', () => {
  it('한국어·일본어 사전의 키, 함수 인자 개수, 목록 길이가 같다', () => {
    const gas = createGas();
    const shape = (name: string) => JSON.parse(gas.eval(`JSON.stringify(Object.keys(${name}).sort().map(function (k) {
      var v = ${name}[k];
      return [k, typeof v === 'function' ? 'fn' + v.length : Array.isArray(v) ? 'arr' + v.length : typeof v];
    }))`) as string);
    expect(shape('MSG_JA_')).toEqual(shape('MSG_KO_'));
  });

  it('모든 사전 값이 비어 있지 않고, 일본어 사전에는 한글이 없다', () => {
    const gas = createGas();
    const values = (name: string) => JSON.parse(gas.eval(`JSON.stringify(Object.keys(${name}).map(function (k) {
      var v = ${name}[k];
      if (typeof v === 'function') { var a = []; for (var i = 0; i < v.length; i++) a.push(i + 1); return String(v.apply(null, a)); }
      return Array.isArray(v) ? v.join('') : v;
    }))`) as string) as string[];
    expect(values('MSG_KO_').every((v) => v.length > 0)).toBe(true);
    const ja = values('MSG_JA_');
    expect(ja.every((v) => v.length > 0)).toBe(true);
    expect(ja.filter((v) => /[가-힣]/.test(v))).toEqual([]);
  });
});

describe('요청 언어 (API 두 번째 인자)', () => {
  it('오류 문구가 요청 언어를 따른다', () => {
    const gas = createReadyGas();
    const input = { title: '', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' };
    expect(err(gas.call('apiSaveSchedule', input, 'ko')).message).toBe('제목을 입력해 주세요.');
    expect(err(gas.call('apiSaveSchedule', input, 'ja')).message).toBe('タイトルを入力してください。');
    expect(err(gas.call('apiSaveSchedule', { ...input, title: 'x'.repeat(201) }, 'ja')).message).toBe('タイトルは200文字以内で入力してください。');
    expect(err(gas.call('apiDeleteSchedule', { id: 'nope', updatedAt: 'x' }, 'ja')).message).toBe('予定が見つかりません。すでに削除された可能性があります。');
  });

  it('권한 오류도 요청 언어로 (소유자 확인보다 먼저 언어를 정한다)', () => {
    const gas = createReadyGas();
    gas.state.activeEmail = 'other@example.com';
    expect(err(gas.call('apiGetToday', null, 'ja'))).toEqual({ code: 'FORBIDDEN', message: 'このアプリを使用する権限がありません。' });
    expect(err(gas.call('apiGetToday', null, 'ko')).message).toBe('이 앱을 사용할 권한이 없습니다.');
  });

  it('언어가 없거나 이상하면: 마지막 화면 언어 → Google 계정 언어 → 일본어', () => {
    const gas = createReadyGas();
    const input = { title: '', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' };
    // 계정 언어 ko (하네스 기본)
    expect(err(gas.call('apiSaveSchedule', input, 'en')).message).toBe('제목을 입력해 주세요.');
    // 계정 언어가 한국어·일본어가 아니면 일본어
    gas.state.activeLocale = 'en';
    expect(err(gas.call('apiSaveSchedule', input)).message).toBe('タイトルを入力してください。');
    gas.state.activeLocale = 'ja-JP';
    expect(err(gas.call('apiSaveSchedule', input, '<script>')).message).toBe('タイトルを入力してください。');
    // 마지막 화면 언어가 계정 언어보다 먼저
    gas.props.set('LAST_UI_LANG', 'ko');
    expect(err(gas.call('apiSaveSchedule', input, null)).message).toBe('제목을 입력해 주세요.');
  });

  it('구글 캘린더 오류·제목 없는 회의도 요청 언어로', () => {
    const gas = createReadyGas();
    gas.state.calendarEvents = [{ title: '', start: '2026-09-24T10:00', end: '2026-09-24T11:00' }];
    const r = ok(gas.call<ApiResult<{ calendarEvents: Array<{ title: string }> }>>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' }, 'ja'));
    expect(r.calendarEvents[0].title).toBe('(タイトルなし)');
    gas.state.calendarThrows = true;
    const r2 = ok(gas.call<ApiResult<{ calendarError: string }>>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' }, 'ja'));
    expect(r2.calendarError).toBe('Googleカレンダーの予定を読み込めませんでした。');
  });

  it('오늘 요약 라벨(요일·종일)과 다이어리 기본 제목', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveSchedule', { title: '종일 작업', allDay: true, startAt: '2026-09-24', endAt: '2026-09-24' }));
    const d = ok(gas.call<ApiResult<{ weekday: string; schedules: Array<{ timeLabel: string }> }>>('apiGetToday', null, 'ja'));
    expect(d.weekday).toBe('木');
    expect(d.schedules[0].timeLabel).toBe('終日');
    const ja = ok(gas.call<ApiResult<{ title: string }>>('apiSaveDiary', { diaryDate: '2026-09-24', content: 'c' }, 'ja'));
    expect(ja.title).toBe('2026年9月24日(木)');
    const ko = ok(gas.call<ApiResult<{ title: string }>>('apiSaveDiary', { diaryDate: '2026-09-25', content: 'c' }, 'ko'));
    expect(ko.title).toBe('2026년 9월 25일 (금)');
    // 이미 저장된 제목은 언어를 바꿔 읽어도 그대로 (데이터)
    const list = ok(gas.call<ApiResult<Array<{ title: string }>>>('apiGetDiaries', { from: '2026-09-24', to: '2026-09-25' }, 'ko'));
    expect(list.map((x) => x.title).sort()).toEqual(['2026年9月24日(木)', '2026년 9월 25일 (금)'].sort());
  });
});

describe('마지막 화면 언어 (LAST_UI_LANG)', () => {
  it('첫 화면: 설정이 자동이면 브라우저 언어, 지정이면 그 언어를 기록한다. 바뀔 때만 쓴다', () => {
    const gas = createReadyGas();
    let writes = 0;
    const orig = gas.props.set.bind(gas.props);
    gas.props.set = (k: string, v: string) => { if (k === 'LAST_UI_LANG') writes++; return orig(k, v); };

    const b = ok(gas.call<ApiResult<{ settings: { language: string } }>>('apiBootstrap', { browserLang: 'ja' }, 'ja'));
    expect(b.settings.language).toBe('auto');
    expect(gas.props.get('LAST_UI_LANG')).toBe('ja');
    ok(gas.call('apiBootstrap', { browserLang: 'ja' }, 'ja'));
    expect(writes).toBe(1);

    ok(saveSettings(gas, { language: 'ko', browserLang: 'ja' }, 'ja'));
    expect(gas.props.get('LAST_UI_LANG')).toBe('ko');
    ok(gas.call('apiBootstrap', { browserLang: 'ja' }, 'ja'));
    expect(gas.props.get('LAST_UI_LANG')).toBe('ko');
    expect(writes).toBe(2);
  });

  it('이상한 브라우저 언어는 기록하지 않는다', () => {
    const gas = createReadyGas();
    ok(gas.call('apiBootstrap', { browserLang: 'en' }));
    ok(gas.call('apiBootstrap', 'not-an-object'));
    expect(gas.props.get('LAST_UI_LANG')).toBeUndefined();
  });
});

describe('언어 설정', () => {
  it('저장·읽기, 자동으로 바꾸면 브라우저 언어를 마지막 화면 언어로', () => {
    const gas = createReadyGas();
    const v = ok(saveSettings(gas, { language: 'ja', browserLang: 'ko' }));
    expect(v.settings.language).toBe('ja');
    expect(sheetValue(gas, 'language')).toBe('ja');
    expect(gas.props.get('LAST_UI_LANG')).toBe('ja');
    ok(saveSettings(gas, { language: 'auto', browserLang: 'ko' }));
    expect(gas.props.get('LAST_UI_LANG')).toBe('ko');
    ok(saveSettings(gas, { language: 'auto' })); // 브라우저 언어가 없으면 그대로 둔다
    expect(gas.props.get('LAST_UI_LANG')).toBe('ko');
  });

  it('검증: auto·ko·ja만', () => {
    const gas = createReadyGas();
    expect(err(saveSettings(gas, { language: 'en' }, 'ko'))).toEqual({ code: 'VALIDATION', message: '화면 언어가 올바르지 않습니다.' });
    expect(err(saveSettings(gas, { language: '' }, 'ja')).message).toBe('表示言語を選択してください。');
    expect(err(saveSettings(gas, { language: ['ja'] }, 'ko')).code).toBe('VALIDATION');
  });

  it('언어 항목이 없는 옛 화면(v1.12)에서 저장해도 막히지 않고 지금 언어를 유지한다', () => {
    const gas = createReadyGas();
    ok(saveSettings(gas, { language: 'ja' }));
    const v = ok(saveSettings(gas, { language: undefined, backupKeep: 9 }));
    expect(v.settings.language).toBe('ja');
    expect(sheetValue(gas, 'language')).toBe('ja');
    expect(sheetValue(gas, 'backup_keep')).toBe('9');
  });

  it('시트를 손으로 이상한 값으로 고치면 자동으로 읽는다', () => {
    const gas = createReadyGas();
    const s = gas.sheet('settings');
    for (let r = 2; r <= s.getLastRow(); r++) if (s.rawRow(r)[0] === 'language') s.write(r, 2, 'fr');
    expect(ok(gas.call<ApiResult<{ settings: { language: string } }>>('apiGetSettings')).settings.language).toBe('auto');
  });
});

describe('메일 언어', () => {
  const sendDigest = (gas: Gas) => {
    ok(gas.call('apiSaveSchedule', { title: '중요 작업', priority: 'HIGH', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' }));
    gas.state.calendarEvents = [{ title: '定例会議', start: '2026-09-24T13:00', end: '2026-09-24T14:00' }];
    expect(gas.call('sendMorningDigest')).toBe('SENT');
    return gas.state.sentMails[gas.state.sentMails.length - 1];
  };

  it('설정이 자동이면 마지막 화면 언어로 보낸다 (일본어 메일)', () => {
    const gas = createReadyGas();
    gas.props.set('LAST_UI_LANG', 'ja');
    const m = sendDigest(gas);
    expect(m.subject).toBe('[スケジュール管理] 9/24(木) 予定1件・会議1件');
    expect(m.name).toBe('スケジュール管理');
    expect(m.htmlBody).toContain('lang="ja"');
    expect(m.htmlBody).toContain('今日の予定');
    expect(m.htmlBody).toContain('Googleカレンダーの会議');
    expect(m.htmlBody).toContain('[重要]');
    expect(m.body).toContain('[重要] 중요 작업（10:00〜11:00・作業）');
    expect(m.htmlBody).toContain('<span style="color:#6b7280">（13:00〜14:00）</span>');
    // 한글은 입력한 일정 제목뿐 (문구는 모두 일본어)
    expect(m.htmlBody.split('중요 작업').join('')).not.toMatch(/[\uac00-\ud7a3]/);
    expect(m.body.split('중요 작업').join('')).not.toMatch(/[\uac00-\ud7a3]/);
  });

  it('언어를 지정했으면 마지막 화면 언어와 상관없이 그 언어', () => {
    const gas = createReadyGas();
    ok(saveSettings(gas, { language: 'ko' }));
    gas.props.set('LAST_UI_LANG', 'ja');
    const m = sendDigest(gas);
    expect(m.subject).toBe('[스케줄관리] 9/24(목) 일정 1건 · 회의 1건');
    expect(m.htmlBody).toContain('lang="ko"');
  });

  it('마지막 화면 언어가 없으면 Google 계정 언어, 그것도 아니면 일본어', () => {
    const ko = createReadyGas();
    expect(sendDigest(ko).subject).toMatch(/^\[스케줄관리\]/);
    const en = createReadyGas();
    en.state.activeLocale = 'en';
    expect(sendDigest(en).subject).toMatch(/^\[スケジュール管理\]/);
  });

  it('한국어 메일 본문 모양은 그대로 (괄호·구분자)', () => {
    const gas = createReadyGas();
    const m = sendDigest(gas);
    expect(m.body).toContain('[중요] 중요 작업 (10:00~11:00 · 작업)');
    expect(m.htmlBody).toContain('<span style="color:#6b7280"> (13:00~14:00)</span>');
  });

  it('메일 제목의 날짜는 앞의 0 없이 (10/5)', () => {
    const gas = createReadyGas();
    gas.setNow('2026-10-05T07:30:00+09:00'); // 월요일
    gas.props.set('LAST_UI_LANG', 'ja');
    expect(gas.call('sendMorningDigest')).toBe('SENT');
    expect(gas.state.sentMails[0].subject).toMatch(/^\[スケジュール管理\] 10\/5\(月\)/);
  });

  it('테스트 메일: 메일 언어로 바꾸기 전에 시트를 확인해 시트 오류는 화면 언어로', () => {
    const gas = createReadyGas();
    gas.props.set('LAST_UI_LANG', 'ja');
    gas.spreadsheet().deleteSheet(gas.sheet('projects'));
    expect(err(gas.call('apiSendTestDigest', null, 'ko')).message).toBe('projects 시트가 없습니다. setup을 다시 실행해 주세요.');
  });

  it('테스트 메일은 아침 메일과 같은 언어, 오류 문구는 화면 언어', () => {
    const gas = createReadyGas();
    ok(saveSettings(gas, { language: 'ja' }));
    ok(gas.call('apiSendTestDigest', null, 'ko'));
    expect(gas.state.sentMails[0].subject).toMatch(/^\[テスト\] \[スケジュール管理\] 9\/24\(木\)/);
    for (let i = 0; i < 4; i++) ok(gas.call('apiSendTestDigest', null, 'ko'));
    expect(err(gas.call('apiSendTestDigest', null, 'ko')).message).toBe('테스트 메일은 하루 5번까지 보낼 수 있습니다.');
    expect(err(gas.call('apiSendTestDigest', null, 'ja')).message).toBe('テストメールは1日5回まで送信できます。');
  });
});

describe('웹앱 진입 (doGet)', () => {
  it('탭 제목은 마지막 화면 언어의 앱 이름', () => {
    const gas = createReadyGas();
    expect((gas.raw('doGet') as { title: string }).title).toBe('스케줄관리');
    gas.props.set('LAST_UI_LANG', 'ja');
    expect((gas.raw('doGet') as { title: string }).title).toBe('スケジュール管理');
  });

  it('초기 설정 전·권한 없음 페이지는 두 언어로', () => {
    const gas = createGas();
    const out = gas.raw('doGet') as { html: string; title: string };
    expect(out.html).toContain('초기 설정이 필요합니다');
    expect(out.html).toContain('初期設定が必要です');
    expect(out.title).toBe('스케줄관리 / スケジュール管理');
    gas.call('setup');
    gas.state.activeEmail = 'other@example.com';
    const out2 = gas.raw('doGet') as { html: string };
    expect(out2.html).toContain('이 앱을 사용할 권한이 없습니다.');
    expect(out2.html).toContain('このアプリを使用する権限がありません。');
  });
});

describe('setup·runSelfTest 로그', () => {
  it('Google 계정 언어가 일본어면 일본어, 한국어면 한국어', () => {
    const ja = createGas();
    ja.state.activeLocale = 'ja';
    const report = ja.call<string>('setup');
    expect(report).toContain('[OK] シート作成: schedules');
    expect(report).toContain('[OK] トリガー設定: 朝のメール 毎日7〜8時、バックアップ 毎週月曜3〜4時');
    expect(report).not.toMatch(/[가-힣]/);
    const self = ja.call<string>('runSelfTest');
    expect(self).not.toContain('[FAIL]');
    expect(self).toContain('[OK] 所有者の確認');

    const en = createGas();
    en.state.activeLocale = 'en';
    expect(en.call<string>('setup')).toContain('[OK] シート作成');

    const ko = createGas();
    expect(ko.call<string>('setup')).toContain('[OK] 시트 생성: schedules');
  });
});

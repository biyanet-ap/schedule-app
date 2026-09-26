/**
 * 로컬 개발용 목 API (`npm run dev`). Google 없이 화면을 개발·확인하기 위한 것으로,
 * 운영 빌드에는 포함되지 않는다. 서버 규칙 중 화면 동작에 영향이 있는 것(필수값, 낙관적 잠금, 기간 기록 규칙)만 흉내 낸다.
 * v1.13: 샘플 데이터는 목을 만들 때의 화면 언어(브라우저 언어)로 고른다 — 일본어 화면 점검·설명서 캡처용.
 *        오류 문구는 부를 때의 화면 언어. 주소 뒤 ?mock=lang-ko / lang-ja 로 언어 설정을 지정한 상태로 시작할 수 있다.
 */
import { lang, msgs, type Lang, type LangSetting } from '../i18n';
import { addDays, dateSpan, inRange, occursOn, timeLabel, weekdayOf } from '../utils/date';
import { diaryDefaultTitle } from '../utils/diary';
import { periodError, weekRange, worklogSpan } from '../utils/worklog';
import {
  ApiError,
  type Api,
  type CalendarEvent,
  type Diary,
  type Holiday,
  type Project,
  type NotifyLogRow,
  type Schedule,
  type SettingsView,
  type TrashKind,
  type Worklog,
} from './types';

const LATENCY_MS = 120;
const WORKLOG_PERIOD_DAYS = 92;
const TRASH_DAYS = 30;
const TRASH_ITEMS = 300;
const DIGEST_HOURS = [5, 6, 7, 8, 9, 10];
const TEST_MAIL_PER_DAY = 5;

function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const JST_STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** 서버 nowStamp_와 같은 모양: '2026-09-25T14:03:10.123+09:00' */
function stamp(): string {
  const now = new Date();
  const p = Object.fromEntries(JST_STAMP.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(now.getMilliseconds()).padStart(3, '0')}+09:00`;
}

function uid(): string {
  return crypto.randomUUID();
}

function delay<T>(value: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(structuredClone(value()));
      } catch (e) {
        reject(e);
      }
    }, LATENCY_MS);
  });
}

/** 목 전용 문구: 부를 때의 화면 언어로 고른다 */
function L(ko: string, ja: string): string {
  return lang.value === 'ja' ? ja : ko;
}

function requireTitle(title: string, message: string) {
  if (!title.trim()) throw new ApiError('VALIDATION', message);
}

/** 샘플 데이터 문구 (사용자가 입력한 데이터에 해당) */
const SAMPLES = {
  ko: {
    projects: ['프로젝트 A', '프로젝트 B', '사내 업무'],
    schedules: ['신규 기능 릴리스 준비', '로그인 화면 코드 리뷰', '결제 모듈 개선', '협력사 정기 미팅', '배포 체크리스트 정리', '로그 수집 파이프라인 점검', '서버 OS 업그레이드 계획'],
    scheduleTags: ['DB', '배포'],
    worklogs: [
      { title: '이번 주 업무 정리', content: '주요 진행 사항\n- 릴리스 준비\n- 코드 리뷰', tags: ['주간'] },
      { title: 'DB 설정 비교', content: '버전별 변경 설정 12개 정리\n- 기본값 차이 확인', tags: ['DB', '설정'] },
      { title: '대시보드 버그 수정', content: '날짜 필터 시간대 오류 수정 (UTC→JST)', tags: ['버그'] },
      { title: '로그 파이프라인 점검 완료', content: 'CloudWatch 구독 필터 누락 1건 보완', tags: ['운영'] },
      { title: '주간 보고 작성', content: '', tags: [] as string[] },
    ],
    diaries: [
      { title: '비 오는 날', content: '출근길에 비가 많이 왔다.\n점심은 동료들과 새로 생긴 가게에서.' },
      { title: '', content: '오랜만에 일찍 퇴근해서 산책을 했다.' },
      { title: '주말 정리', content: '다음 주 계획을 세우고 책을 조금 읽었다.' },
    ],
    calendar: ['주간 개발 회의', '1on1', '전사 워크숍'],
    room: '3F 회의실',
    holiday: '祝日(샘플)',
    trashSchedules: ['협력사 방문 준비', '40일 전에 지운 일정'],
    trashWorklog: '테스트 데이터 정리',
    trashDiaries: [
      { title: '지운 다이어리 (같은 날짜에 새 글 있음)', content: '먼저 쓴 글' },
      { title: '', content: '이틀 전 메모' },
    ],
  },
  ja: {
    projects: ['プロジェクトA', 'プロジェクトB', '社内業務'],
    schedules: ['新機能リリースの準備', 'ログイン画面のコードレビュー', '決済モジュールの改善', '協力会社との定例ミーティング', 'デプロイチェックリストの整理', 'ログ収集パイプラインの点検', 'サーバーOSアップグレード計画'],
    scheduleTags: ['DB', 'デプロイ'],
    worklogs: [
      { title: '今週の業務まとめ', content: '主な進捗\n- リリース準備\n- コードレビュー', tags: ['週次'] },
      { title: 'DB設定の比較', content: 'バージョンごとの変更設定12件を整理\n- 既定値の違いを確認', tags: ['DB', '設定'] },
      { title: 'ダッシュボードのバグ修正', content: '日付フィルターのタイムゾーン不具合を修正(UTC→JST)', tags: ['バグ'] },
      { title: 'ログパイプライン点検完了', content: 'CloudWatch サブスクリプションフィルターの漏れ1件を補完', tags: ['運用'] },
      { title: '週報の作成', content: '', tags: [] as string[] },
    ],
    diaries: [
      { title: '雨の日', content: '通勤中に雨がひどかった。\n昼は同僚と新しくできた店へ。' },
      { title: '', content: '久しぶりに早く帰って散歩をした。' },
      { title: '週末のまとめ', content: '来週の計画を立てて、本を少し読んだ。' },
    ],
    calendar: ['週次開発ミーティング', '1on1', '全社ワークショップ'],
    room: '3F 会議室',
    holiday: '祝日(サンプル)',
    trashSchedules: ['協力会社訪問の準備', '40日前に削除した予定'],
    trashWorklog: 'テストデータの整理',
    trashDiaries: [
      { title: '削除した日記(同じ日付に新しい日記あり)', content: '先に書いた日記' },
      { title: '', content: '2日前のメモ' },
    ],
  },
} satisfies Record<Lang, unknown>;

export function createMockApi(): Api {
  const today = jstToday();
  const d = (n: number) => addDays(today, n);
  const now = stamp();
  const S = SAMPLES[lang.value];

  const projects: Project[] = [
    { id: 'p-a', name: S.projects[0], color: '#2563eb', sortOrder: 1, active: true, updatedAt: now },
    { id: 'p-b', name: S.projects[1], color: '#db2777', sortOrder: 2, active: true, updatedAt: now },
    { id: 'p-c', name: S.projects[2], color: '#ea580c', sortOrder: 3, active: true, updatedAt: now },
  ];

  const mk = (p: Partial<Schedule> & Pick<Schedule, 'title' | 'startAt' | 'endAt'>): Schedule => ({
    id: uid(), type: 'TASK', description: '', allDay: false, priority: 'MEDIUM', projectId: '', location: '',
    status: 'PLANNED', tags: [], createdAt: now, updatedAt: now, ...p,
  });

  const schedules: Schedule[] = [
    mk({ title: S.schedules[0], startAt: `${d(0)}T10:00`, endAt: `${d(0)}T12:00`, priority: 'HIGH', projectId: 'p-a', tags: [...S.scheduleTags] }),
    mk({ title: S.schedules[1], startAt: `${d(0)}T15:00`, endAt: `${d(0)}T16:30`, projectId: 'p-b' }),
    mk({ title: S.schedules[2], startAt: `${d(1)}T00:00`, endAt: `${d(3)}T00:00`, allDay: true, projectId: 'p-c' }),
    mk({ title: S.schedules[3], type: 'MEETING', startAt: `${d(2)}T11:00`, endAt: `${d(2)}T12:00`, location: 'https://meet.google.com/abc-defg-hij' }),
    mk({ title: S.schedules[4], startAt: `${d(-3)}T13:00`, endAt: `${d(-3)}T14:00`, projectId: 'p-a' }),
    mk({ title: S.schedules[5], startAt: `${d(-6)}T09:00`, endAt: `${d(-6)}T10:00`, status: 'DONE' }),
    mk({ title: S.schedules[6], startAt: `${d(7)}T10:00`, endAt: `${d(7)}T11:00`, priority: 'HIGH' }),
  ];

  const thisWeek = weekRange(today, 0);
  const worklogs: Worklog[] = [
    { id: uid(), workDate: thisWeek.start, endDate: thisWeek.end, ...S.worklogs[0], tags: [...S.worklogs[0].tags], projectId: 'p-a', scheduleId: '', status: 'IN_PROGRESS', createdAt: now, updatedAt: now },
    { id: uid(), workDate: d(-1), endDate: '', ...S.worklogs[1], tags: [...S.worklogs[1].tags], projectId: 'p-a', scheduleId: '', status: 'DONE', createdAt: now, updatedAt: now },
    { id: uid(), workDate: d(-1), endDate: '', ...S.worklogs[2], tags: [...S.worklogs[2].tags], projectId: 'p-b', scheduleId: '', status: 'IN_PROGRESS', createdAt: now, updatedAt: now },
    { id: uid(), workDate: d(-6), endDate: '', ...S.worklogs[3], tags: [...S.worklogs[3].tags], projectId: '', scheduleId: schedules[5].id, status: 'DONE', createdAt: now, updatedAt: now },
    { id: uid(), workDate: d(-10), endDate: '', ...S.worklogs[4], tags: [...S.worklogs[4].tags], projectId: '', scheduleId: '', status: 'IN_PROGRESS', createdAt: now, updatedAt: now },
  ];

  const diary = (date: string, title: string, content: string): Diary => ({
    id: uid(), diaryDate: date, title: title || diaryDefaultTitle(date), content, createdAt: now, updatedAt: now,
  });
  const diaries: Diary[] = [
    diary(d(-1), S.diaries[0].title, S.diaries[0].content),
    diary(d(-3), S.diaries[1].title, S.diaries[1].content),
    diary(d(-8), S.diaries[2].title, S.diaries[2].content),
  ];

  const calendarEvents: CalendarEvent[] = [
    { id: 'g1', title: S.calendar[0], startAt: `${d(0)}T13:00`, endAt: `${d(0)}T14:00`, allDay: false, location: S.room },
    { id: 'g2', title: S.calendar[1], startAt: `${d(1)}T16:00`, endAt: `${d(1)}T16:30`, allDay: false, location: '' },
    { id: 'g3', title: S.calendar[2], startAt: `${d(9)}T00:00`, endAt: `${d(9)}T00:00`, allDay: true, location: '' },
  ];

  const holidays: Holiday[] = [{ date: d(4), name: S.holiday }];

  // 휴지통 (v1.11): 지운 항목은 여기로 옮기고 updatedAt = 삭제 시각. 서버는 행을 남기고 deleted만 바꾼다
  const at = (n: number, hm: string) => `${d(n)}T${hm}:00.000+09:00`;
  const trash = {
    schedules: [
      mk({ title: S.trashSchedules[0], startAt: `${d(-2)}T14:00`, endAt: `${d(-2)}T15:00`, projectId: 'p-b', updatedAt: at(-2, '15:20') }),
      mk({ title: S.trashSchedules[1], startAt: `${d(-45)}T10:00`, endAt: `${d(-45)}T11:00`, updatedAt: at(-40, '09:00') }),
    ] as Schedule[],
    worklogs: [
      { id: uid(), workDate: d(-9), endDate: d(-7), title: S.trashWorklog, content: '', projectId: 'p-a', scheduleId: '', tags: [], status: 'DONE', createdAt: now, updatedAt: at(-5, '10:05') },
    ] as Worklog[],
    diaries: [
      { ...diary(d(-1), S.trashDiaries[0].title, S.trashDiaries[0].content), updatedAt: at(-1, '22:10') },
      { ...diary(d(-2), S.trashDiaries[1].title, S.trashDiaries[1].content), updatedAt: at(0, '08:30') },
    ] as Diary[],
  };
  const kindName = (kind: TrashKind) => msgs().trash.kinds[kind];

  // 설정 화면 (v1.12). 화면 점검용으로 주소 뒤 ?mock=broken-triggers / popup-off / lang-ko / lang-ja 를 붙이면 그 상태로 시작한다
  const mockFlags = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).getAll('mock');
  const initialLanguage: LangSetting = mockFlags.includes('lang-ko') ? 'ko' : mockFlags.includes('lang-ja') ? 'ja' : 'auto';
  const settingsState = {
    settings: { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: !mockFlags.includes('popup-off'), digestHour: 7, backupKeep: 8, language: initialLanguage },
    updatedAt: '',
    triggers: mockFlags.includes('broken-triggers') ? { digest: 0, backup: 2 } : { digest: 1, backup: 1 },
    // 샘플 기록 (오늘이 금요일일 때 요일이 맞는 모양. 다른 요일에는 요일과 결과가 어긋나도 화면 확인용이라 무관)
    log: [
      { loggedAt: at(-6, '07:10'), kind: 'DIGEST', targetDate: d(-6), result: 'SKIPPED_WEEKEND', detail: '' },
      { loggedAt: at(-5, '07:04'), kind: 'DIGEST', targetDate: d(-5), result: 'SKIPPED_WEEKEND', detail: '' },
      { loggedAt: at(-4, '03:20'), kind: 'BACKUP', targetDate: d(-4), result: 'OK', detail: '' },
      { loggedAt: at(-4, '07:08'), kind: 'DIGEST', targetDate: d(-4), result: 'SENT', detail: '' },
      { loggedAt: at(-3, '07:06'), kind: 'DIGEST', targetDate: d(-3), result: 'SKIPPED_HOLIDAY', detail: S.holiday },
      { loggedAt: at(-2, '07:05'), kind: 'DIGEST', targetDate: d(-2), result: 'FAILED', detail: 'Service invoked too many times for one day: email.' },
      { loggedAt: at(-1, '07:31'), kind: 'DIGEST', targetDate: d(-1), result: 'SENT', detail: '' },
    ] as NotifyLogRow[],
    testSent: 0,
  };
  const settingsView = (): SettingsView => ({
    settings: { ...settingsState.settings },
    updatedAt: settingsState.updatedAt,
    digestHours: [...DIGEST_HOURS],
    limits: { backupKeepMax: 100, testMailPerDay: TEST_MAIL_PER_DAY },
    triggers: { ...settingsState.triggers },
    recentLog: [...settingsState.log].reverse().slice(0, 10),
  });
  /** 목록에서 꺼내 휴지통으로 옮긴다 (삭제 시각을 updatedAt에) */
  const moveToTrash = <T extends { id: string; updatedAt: string }>(list: T[], bin: T[], id: string) => {
    const i = list.findIndex((x) => x.id === id);
    const [item] = list.splice(i, 1);
    item.updatedAt = stamp();
    bin.push(item);
    return { id, updatedAt: item.updatedAt };
  };
  /** 휴지통에서 꺼내 목록으로 되돌린다 (서버와 같은 잠금 규칙) */
  const takeFromTrash = <T extends { id: string; updatedAt: string }>(kind: TrashKind, bin: T[], id: string, updatedAt: string, check?: (item: T) => void) => {
    const i = bin.findIndex((x) => x.id === id);
    if (i < 0) throw new ApiError('NOT_FOUND', L(`이미 복구됐거나 찾을 수 없는 ${kindName(kind)} 항목입니다.`, `この${kindName(kind)}はすでに復元されたか、見つかりません。`));
    if (bin[i].updatedAt !== updatedAt) throw new ApiError('CONFLICT', L(`다른 곳에서 먼저 바뀐 ${kindName(kind)} 항목입니다. 휴지통을 새로 불러온 뒤 다시 시도해 주세요.`, `この${kindName(kind)}は別のタブまたは端末で変更されています。ゴミ箱を開き直してからもう一度お試しください。`));
    check?.(bin[i]);
    const [item] = bin.splice(i, 1);
    item.updatedAt = stamp();
    return item;
  };

  const findSchedule = (id: string, updatedAt?: string) => {
    const s = schedules.find((x) => x.id === id);
    if (!s) throw new ApiError('NOT_FOUND', L('일정 항목을 찾을 수 없습니다.', '予定が見つかりません。'));
    if (updatedAt !== undefined && s.updatedAt !== updatedAt) throw new ApiError('CONFLICT', L('다른 곳에서 먼저 수정된 일정 항목입니다. 새로고침 후 다시 시도해 주세요.', 'この予定は別のタブまたは端末で更新されています。再読み込みしてからもう一度お試しください。'));
    return s;
  };
  const findWorklog = (id: string, updatedAt?: string) => {
    const w = worklogs.find((x) => x.id === id);
    if (!w) throw new ApiError('NOT_FOUND', L('작업기록 항목을 찾을 수 없습니다.', '作業記録が見つかりません。'));
    if (updatedAt !== undefined && w.updatedAt !== updatedAt) throw new ApiError('CONFLICT', L('다른 곳에서 먼저 수정된 작업기록 항목입니다. 새로고침 후 다시 시도해 주세요.', 'この作業記録は別のタブまたは端末で更新されています。再読み込みしてからもう一度お試しください。'));
    return w;
  };
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? '';

  return {
    bootstrap: () => delay(() => ({
      today,
      projects,
      settings: {
        notifyEnabled: settingsState.settings.notifyEnabled, skipHolidays: settingsState.settings.skipHolidays,
        todayPopup: settingsState.settings.todayPopup, language: settingsState.settings.language,
      },
      limits: { title: 200, description: 5000, content: 20000, location: 500, tagCount: 10, tagLength: 30, projectName: 50, keyword: 100, rangeDays: 62, worklogPeriodDays: WORKLOG_PERIOD_DAYS },
    })),

    getRange: ({ from, to }) => delay(() => ({
      from,
      to,
      schedules: schedules.filter((s) => { const sp = dateSpan(s); return sp.start <= to && sp.end >= from; }),
      worklogs: worklogs.filter((w) => { const sp = worklogSpan(w); return sp.start <= to && sp.end >= from; }),
      diaries: diaries.filter((x) => inRange(x.diaryDate, from, to)).sort((a, b) => a.diaryDate.localeCompare(b.diaryDate)),
      calendarEvents: calendarEvents.filter((c) => { const sp = dateSpan(c); return sp.start <= to && sp.end >= from; }),
      calendarError: null,
      holidays: holidays.filter((h) => inRange(h.date, from, to)),
      holidayCalendarAvailable: true,
    })),

    getToday: () => delay(() => {
      const todays = schedules.filter((s) => s.status !== 'CANCELLED' && occursOn(s, today));
      const overdue = schedules.filter((s) => s.type === 'TASK' && s.status === 'PLANNED' && dateSpan(s).end < today);
      const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
      const inProgress = worklogs
        .filter((w) => w.status === 'IN_PROGRESS')
        .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.createdAt.localeCompare(b.createdAt));
      return {
        date: today,
        weekday: weekdayOf(today),
        holidayName: holidays.find((h) => h.date === today)?.name ?? null,
        schedules: todays.map((s) => ({ ...s, projectName: projectName(s.projectId), timeLabel: timeLabel(s) })),
        meetings: calendarEvents.filter((c) => occursOn(c, today)).map((c) => ({ ...c, timeLabel: timeLabel(c) })),
        calendarError: null,
        overdue: overdue.slice(0, 10).map((s) => ({ ...s, projectName: projectName(s.projectId), timeLabel: timeLabel(s) })),
        overdueTotal: overdue.length,
        inProgress: inProgress.slice(0, 10).map((w) => ({
          ...w, projectName: projectName(w.projectId), dateLabel: w.endDate ? `${md(w.workDate)}${msgs().date.timeSep}${md(w.endDate)}` : md(w.workDate),
        })),
        inProgressTotal: inProgress.length,
      };
    }),

    saveSchedule: (input) => delay(() => {
      requireTitle(input.title, msgs().schedule.titleRequired);
      const startAt = input.allDay ? `${input.startAt.slice(0, 10)}T00:00` : input.startAt;
      const endAt = input.allDay ? `${input.endAt.slice(0, 10)}T00:00` : input.endAt;
      if (endAt < startAt) throw new ApiError('VALIDATION', msgs().schedule.endBeforeStart);
      const fields = { type: input.type, title: input.title.trim(), description: input.description, allDay: input.allDay, startAt, endAt, priority: input.priority, projectId: input.projectId, location: input.location, status: input.status, tags: input.tags };
      if (input.id) {
        const s = findSchedule(input.id, input.updatedAt);
        Object.assign(s, fields, { updatedAt: stamp() });
        return s;
      }
      const created: Schedule = { id: uid(), ...fields, createdAt: stamp(), updatedAt: stamp() };
      schedules.push(created);
      return created;
    }),

    deleteSchedule: ({ id, updatedAt }) => delay(() => {
      findSchedule(id, updatedAt);
      return moveToTrash(schedules, trash.schedules, id);
    }),

    setScheduleStatus: ({ id, status, updatedAt }) => delay(() => {
      const s = findSchedule(id, updatedAt);
      Object.assign(s, { status, updatedAt: stamp() });
      return s;
    }),

    saveWorklog: (input) => delay(() => {
      requireTitle(input.title, msgs().worklog.titleRequired);
      // 서버와 같게: endDate를 보내지 않으면 새 기록은 하루, 수정은 기존 값 유지
      const endDate = input.endDate ?? (input.id ? findWorklog(input.id).endDate : '');
      const periodMessage = endDate ? periodError(input.workDate, endDate, WORKLOG_PERIOD_DAYS) : '';
      if (periodMessage) throw new ApiError('VALIDATION', periodMessage);
      const fields = { workDate: input.workDate, endDate, title: input.title.trim(), content: input.content, projectId: input.projectId, scheduleId: input.scheduleId, tags: input.tags, status: input.status };
      let saved: Worklog;
      if (input.id) {
        saved = findWorklog(input.id, input.updatedAt);
        Object.assign(saved, fields, { updatedAt: stamp() });
      } else {
        saved = { id: uid(), ...fields, createdAt: stamp(), updatedAt: stamp() };
        worklogs.push(saved);
      }
      let completedSchedule: Schedule | null = null;
      if (input.completeSchedule && input.scheduleId) {
        const s = schedules.find((x) => x.id === input.scheduleId);
        if (s && s.status !== 'DONE') {
          Object.assign(s, { status: 'DONE', updatedAt: stamp() });
          completedSchedule = s;
        }
      }
      return { worklog: saved, completedSchedule };
    }),

    setWorklogStatus: ({ id, status, updatedAt }) => delay(() => {
      const w = findWorklog(id, updatedAt);
      Object.assign(w, { status, updatedAt: stamp() });
      return w;
    }),

    deleteWorklog: ({ id, updatedAt }) => delay(() => {
      findWorklog(id, updatedAt);
      return moveToTrash(worklogs, trash.worklogs, id);
    }),

    search: (q) => delay(() => {
      const kw = q.keyword.trim().toLowerCase();
      if (!kw) throw new ApiError('VALIDATION', L('검색어를 입력해 주세요.', '検索キーワードを入力してください。'));
      if (q.from && q.to && q.to < q.from) throw new ApiError('VALIDATION', msgs().search.rangeOrder);
      const hit = (...fields: string[]) => fields.some((f) => f.toLowerCase().includes(kw));
      // 서버와 같게: 기간과 하루라도 겹치면 포함
      const inPeriod = (sp: { start: string; end: string }) => (!q.from || sp.end >= q.from) && (!q.to || sp.start <= q.to);
      return {
        worklogs: worklogs
          .filter((w) => (!q.projectId || w.projectId === q.projectId) && inPeriod(worklogSpan(w)) && hit(w.title, w.content, w.tags.join(' ')))
          .sort((a, b) => b.workDate.localeCompare(a.workDate)),
        schedules: schedules
          .filter((s) => (!q.projectId || s.projectId === q.projectId) && inPeriod(dateSpan(s)) && hit(s.title, s.description, s.location, s.tags.join(' ')))
          .sort((a, b) => b.startAt.localeCompare(a.startAt)),
        truncated: false,
      };
    }),

    getDiaries: ({ from, to }) => delay(() => diaries.filter((x) => inRange(x.diaryDate, from, to)).sort((a, b) => a.diaryDate.localeCompare(b.diaryDate))),

    saveDiary: (input) => delay(() => {
      const content = input.content.trim();
      if (!content) throw new ApiError('VALIDATION', msgs().diary.contentRequired);
      const base = input.id ? diaries.find((x) => x.id === input.id) : undefined;
      if (input.id && !base) throw new ApiError('NOT_FOUND', L('다이어리 항목을 찾을 수 없습니다. 이미 삭제됐을 수 있습니다.', '日記が見つかりません。すでに削除された可能性があります。'));
      if (base && base.updatedAt !== input.updatedAt) throw new ApiError('CONFLICT', L('다른 곳에서 먼저 수정된 다이어리 항목입니다. 새로고침 후 다시 시도해 주세요.', 'この日記は別のタブまたは端末で更新されています。再読み込みしてからもう一度お試しください。'));
      if (diaries.some((x) => x.diaryDate === input.diaryDate && x.id !== input.id)) {
        throw new ApiError('CONFLICT', L(`${input.diaryDate}에는 이미 다이어리가 있습니다. 화면을 새로 불러온 뒤 기존 다이어리를 수정해 주세요.`, `${input.diaryDate}にはすでに日記があります。画面を再読み込みしてから、既存の日記を編集してください。`));
      }
      const fields = { diaryDate: input.diaryDate, title: input.title.trim() || diaryDefaultTitle(input.diaryDate), content, updatedAt: stamp() };
      if (base) return Object.assign(base, fields);
      const created: Diary = { id: uid(), createdAt: stamp(), ...fields };
      diaries.push(created);
      return created;
    }),

    deleteDiary: ({ id, updatedAt }) => delay(() => {
      const i = diaries.findIndex((x) => x.id === id);
      if (i < 0) throw new ApiError('NOT_FOUND', L('다이어리 항목을 찾을 수 없습니다. 이미 삭제됐을 수 있습니다.', '日記が見つかりません。すでに削除された可能性があります。'));
      if (diaries[i].updatedAt !== updatedAt) throw new ApiError('CONFLICT', L('다른 곳에서 먼저 수정된 다이어리 항목입니다. 새로고침 후 다시 시도해 주세요.', 'この日記は別のタブまたは端末で更新されています。再読み込みしてからもう一度お試しください。'));
      return moveToTrash(diaries, trash.diaries, id);
    }),

    searchDiaries: ({ keyword }) => delay(() => {
      const kw = keyword.trim().toLowerCase();
      if (!kw) throw new ApiError('VALIDATION', L('검색어를 입력해 주세요.', '検索キーワードを入力してください。'));
      const hits = diaries
        .filter((x) => x.title.toLowerCase().includes(kw) || x.content.toLowerCase().includes(kw))
        .sort((a, b) => b.diaryDate.localeCompare(a.diaryDate));
      return { diaries: hits.slice(0, 100), truncated: hits.length > 100 };
    }),

    getTrash: () => delay(() => {
      const from = d(-(TRASH_DAYS - 1));
      const recent = <T extends { updatedAt: string }>(bin: T[]) => bin.filter((x) => x.updatedAt.slice(0, 10) >= from);
      // 서버와 같게: 목록에는 본문을 비워서 보낸다
      const items = [
        ...recent(trash.schedules).map((x) => ({ kind: 'SCHEDULE' as const, at: x.updatedAt, x: { ...x, description: '' } })),
        ...recent(trash.worklogs).map((x) => ({ kind: 'WORKLOG' as const, at: x.updatedAt, x: { ...x, content: '' } })),
        ...recent(trash.diaries).map((x) => ({ kind: 'DIARY' as const, at: x.updatedAt, x: { ...x, content: '' } })),
      ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      const kept = items.slice(0, TRASH_ITEMS);
      return {
        days: TRASH_DAYS,
        schedules: kept.flatMap((i) => (i.kind === 'SCHEDULE' ? [i.x as Schedule] : [])),
        worklogs: kept.flatMap((i) => (i.kind === 'WORKLOG' ? [i.x as Worklog] : [])),
        diaries: kept.flatMap((i) => (i.kind === 'DIARY' ? [i.x as Diary] : [])),
        total: items.length,
        truncated: items.length > kept.length,
      };
    }),

    restoreSchedule: ({ id, updatedAt }) => delay(() => {
      const s = takeFromTrash('SCHEDULE', trash.schedules, id, updatedAt);
      schedules.push(s);
      return s;
    }),

    restoreWorklog: ({ id, updatedAt }) => delay(() => {
      const w = takeFromTrash('WORKLOG', trash.worklogs, id, updatedAt);
      worklogs.push(w);
      return w;
    }),

    restoreDiary: ({ id, updatedAt }) => delay(() => {
      const x = takeFromTrash('DIARY', trash.diaries, id, updatedAt, (item) => {
        if (diaries.some((o) => o.diaryDate === item.diaryDate)) {
          throw new ApiError('CONFLICT', L(
            `${diaryDefaultTitle(item.diaryDate)}에는 이미 다이어리가 있습니다. 그 다이어리를 먼저 삭제한 뒤 복구해 주세요.`,
            `${diaryDefaultTitle(item.diaryDate)}にはすでに日記があります。その日記を先に削除してから復元してください。`,
          ));
        }
      });
      diaries.push(x);
      return x;
    }),

    getSettings: () => delay(settingsView),

    saveSettings: (input) => delay(() => {
      if (input.updatedAt !== settingsState.updatedAt) throw new ApiError('CONFLICT', L('다른 곳에서 먼저 바뀐 설정입니다. 새로고침 후 다시 시도해 주세요.', '設定は別のタブまたは端末で変更されています。再読み込みしてからもう一度お試しください。'));
      if (!DIGEST_HOURS.includes(input.digestHour)) throw new ApiError('VALIDATION', L('발송 시각은 5~10 사이의 정수여야 합니다.', '送信時刻は5〜10の整数で指定してください。'));
      if (!Number.isInteger(input.backupKeep) || input.backupKeep < 1 || input.backupKeep > 100) throw new ApiError('VALIDATION', L('백업 보관 개수는 1~100 사이의 정수여야 합니다.', 'バックアップの保存数は1〜100の整数で指定してください。'));
      if (!['auto', 'ko', 'ja'].includes(input.language)) throw new ApiError('VALIDATION', L('화면 언어가 올바르지 않습니다.', '表示言語が正しくありません。'));
      const replaced = input.digestHour !== settingsState.settings.digestHour;
      const { updatedAt: _base, browserLang: _browser, ...next } = input;
      settingsState.settings = { ...next };
      settingsState.updatedAt = stamp();
      if (replaced) settingsState.triggers.digest = 1;
      return { ...settingsView(), digestTriggerReplaced: replaced };
    }),

    repairTriggers: () => delay(() => {
      settingsState.triggers = { digest: 1, backup: 1 };
      return settingsView();
    }),

    sendTestDigest: () => delay(() => {
      if (settingsState.testSent >= TEST_MAIL_PER_DAY) throw new ApiError('VALIDATION', L(`테스트 메일은 하루 ${TEST_MAIL_PER_DAY}번까지 보낼 수 있습니다.`, `テストメールは1日${TEST_MAIL_PER_DAY}回まで送信できます。`));
      settingsState.testSent++;
      settingsState.log.push({ loggedAt: stamp(), kind: 'DIGEST_TEST', targetDate: today, result: 'SENT', detail: '' });
      return { sentToday: settingsState.testSent };
    }),

    saveProject: (input) => delay(() => {
      requireTitle(input.name, msgs().projects.nameRequired);
      if (projects.some((p) => p.id !== input.id && p.name.toLowerCase() === input.name.trim().toLowerCase())) {
        throw new ApiError('VALIDATION', L('같은 이름의 프로젝트가 이미 있습니다.', '同じ名前のプロジェクトがすでにあります。'));
      }
      const fields = { name: input.name.trim(), color: input.color, sortOrder: input.sortOrder, active: input.active };
      if (input.id) {
        const p = projects.find((x) => x.id === input.id);
        if (!p) throw new ApiError('NOT_FOUND', L('프로젝트 항목을 찾을 수 없습니다.', 'プロジェクトが見つかりません。'));
        Object.assign(p, fields, { updatedAt: stamp() });
        return p;
      }
      const created: Project = { id: uid(), ...fields, updatedAt: stamp() };
      projects.push(created);
      return created;
    }),
  };
}

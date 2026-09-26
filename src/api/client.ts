import { ApiError, type Api, type ApiErrorCode } from './types';
import { lang, msgs } from '../i18n';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } };

/**
 * google.script.run을 Promise로 감싼다.
 * 서버는 항상 { ok, data | error } 봉투로 응답한다. 네트워크·권한 만료 등은 failureHandler로 온다.
 * v1.13: 모든 서버 함수는 (input, lang). 입력이 없어도 첫 자리는 null로 채우고 두 번째에 화면 언어를 보낸다.
 */
function call<T>(fn: string, arg?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runner = google.script.run
      .withSuccessHandler((res: Envelope<T> | null) => {
        if (!res) reject(new ApiError('INTERNAL', msgs().api.emptyResponse));
        else if (res.ok) resolve(res.data);
        else reject(new ApiError(res.error.code, res.error.message));
      })
      .withFailureHandler((error: Error) => {
        reject(new ApiError('NETWORK', msgs().api.network(error?.message ?? 'unknown')));
      }) as unknown as Record<string, (arg: unknown, lang: string) => void>;
    const target = runner[fn];
    if (typeof target !== 'function') {
      reject(new ApiError('INTERNAL', msgs().api.unknownFunction(fn)));
      return;
    }
    target(arg === undefined ? null : arg, lang.value);
  });
}

export const gasApi: Api = {
  bootstrap: (input) => call('apiBootstrap', input),
  getRange: (range) => call('apiGetRange', range),
  getToday: () => call('apiGetToday'),
  saveSchedule: (input) => call('apiSaveSchedule', input),
  deleteSchedule: (input) => call('apiDeleteSchedule', input),
  setScheduleStatus: (input) => call('apiSetScheduleStatus', input),
  saveWorklog: (input) => call('apiSaveWorklog', input),
  deleteWorklog: (input) => call('apiDeleteWorklog', input),
  setWorklogStatus: (input) => call('apiSetWorklogStatus', input),
  search: (query) => call('apiSearch', query),
  saveProject: (input) => call('apiSaveProject', input),
  getDiaries: (range) => call('apiGetDiaries', range),
  saveDiary: (input) => call('apiSaveDiary', input),
  deleteDiary: (input) => call('apiDeleteDiary', input),
  searchDiaries: (query) => call('apiSearchDiaries', query),
  getTrash: () => call('apiGetTrash'),
  restoreSchedule: (input) => call('apiRestoreSchedule', input),
  restoreWorklog: (input) => call('apiRestoreWorklog', input),
  restoreDiary: (input) => call('apiRestoreDiary', input),
  getSettings: () => call('apiGetSettings'),
  saveSettings: (input) => call('apiSaveSettings', input),
  repairTriggers: () => call('apiRepairTriggers'),
  sendTestDigest: () => call('apiSendTestDigest'),
};

/**
 * 로컬 개발(`vite --mode mock`)에서는 목 API를 쓴다.
 * MODE는 빌드 때 문자열로 치환되므로 운영 빌드에는 목 코드가 들어가지 않는다.
 */
export async function createApi(): Promise<Api> {
  if (import.meta.env.MODE === 'mock') {
    const { createMockApi } = await import('./mock');
    return createMockApi();
  }
  return gasApi;
}

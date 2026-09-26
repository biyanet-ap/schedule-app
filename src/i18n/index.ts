/**
 * 화면 다국어 (v1.13). 설계: docs/design/i18n.md
 * - 사전: ko.ts(원본 모양) / ja.ts(같은 모양이어야 타입 체크 통과)
 * - 화면 언어: 설정 'ko'·'ja'면 그 값, 'auto'면 브라우저 언어 목록에서 앞쪽의 한국어·일본어, 둘 다 없으면 일본어
 * - 컴포넌트는 `tr`(현재 사전, computed)을, 유틸·스토어는 `msgs()`를 쓴다.
 */
import { computed, ref } from 'vue';
import ko, { type Messages } from './ko';
import ja from './ja';

export type Lang = 'ko' | 'ja';
export type LangSetting = 'auto' | Lang;
export type { Messages };

export const LANGS: readonly Lang[] = ['ko', 'ja'];
export const LANG_SETTINGS: readonly LangSetting[] = ['auto', 'ko', 'ja'];
export const DEFAULT_LANG: Lang = 'ja';

/** 언어 이름은 화면 언어와 상관없이 그 언어로 표시한다 (일본어 화면에서도 '한국어'가 보여야 찾을 수 있다) */
export const LANG_NAMES: Readonly<Record<Lang, string>> = { ko: '한국어', ja: '日本語' };

const DICTS: Readonly<Record<Lang, Messages>> = { ko, ja };

/** 브라우저 언어 목록 → 'ko' | 'ja'. 앞에서부터 처음 맞는 것(주 언어 코드 단위: 'kok'·'jam'은 아님), 없으면 일본어 */
export function langFromList(languages: readonly string[] | undefined | null): Lang {
  for (const l of languages ?? []) {
    const m = /^([a-z]{2,3})(?:[-_]|$)/.exec(String(l).toLowerCase());
    if (m && (m[1] === 'ko' || m[1] === 'ja')) return m[1];
  }
  return DEFAULT_LANG;
}

export function isLangSetting(v: unknown): v is LangSetting {
  return typeof v === 'string' && (LANG_SETTINGS as readonly string[]).includes(v);
}

/** 설정 값 + 브라우저 언어 목록 → 화면 언어 */
export function resolveLang(setting: unknown, languages: readonly string[] | undefined | null): Lang {
  if (setting === 'ko' || setting === 'ja') return setting;
  return langFromList(languages);
}

/** 이 브라우저의 언어 (설정 '자동'일 때 쓰는 값). languages가 비어 있으면 language로 */
export function browserLang(): Lang {
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langFromList(list);
}

/** 설정 값 → 이 브라우저의 화면 언어 (첫 화면·설정 저장 공용. 서버에 보내는 browserLang과 같은 판정) */
export function screenLang(setting: unknown): Lang {
  return setting === 'ko' || setting === 'ja' ? setting : browserLang();
}

/** 지금 화면 언어. 첫 화면에서 설정을 받기 전에는 브라우저 언어 */
export const lang = ref<Lang>(browserLang());

/** 지금 언어의 사전 (컴포넌트 템플릿에서 `tr.xxx`) */
export const tr = computed<Messages>(() => DICTS[lang.value]);

/** 지금 언어의 사전 (유틸·스토어용) */
export function msgs(): Messages {
  return DICTS[lang.value];
}

/** 정해진 언어의 사전 (예: 다른 언어로 저장된 다이어리 기본 제목 알아보기) */
export function msgsOf(l: Lang): Messages {
  return DICTS[l];
}

export function setLang(next: Lang): void {
  lang.value = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

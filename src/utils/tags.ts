import { msgs } from '../i18n';

/** 쉼표로 구분한 태그 입력을 서버 규칙과 같게 정리한다: 앞의 # 제거, 공백 정리, 대소문자 무시 중복 제거 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(',')
    .map((t) => t.replace(/^#+/, '').trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** 한도 검사. 문제가 없으면 '' */
export function validateTags(tags: string[], limits: { tagCount: number; tagLength: number } | null): string {
  if (!limits) return '';
  const m = msgs().tags;
  if (tags.length > limits.tagCount) return m.tooMany(limits.tagCount);
  if (tags.some((t) => t.length > limits.tagLength)) return m.tooLong(limits.tagLength);
  return '';
}

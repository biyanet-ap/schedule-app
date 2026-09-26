/**
 * 테스트 공통: 브라우저 언어를 한국어로 둔다 (v1.13).
 * Node에도 navigator(language 'en-US')가 있어서 그대로 두면 화면 언어가 일본어(기본값)로 정해진다.
 * 기존 테스트는 한국어 문구를 기준으로 하므로 한국어 브라우저로 흉내 내고, 일본어는 tests/web/i18n.test.ts에서 따로 본다.
 */
import { vi } from 'vitest';

vi.stubGlobal('navigator', { language: 'ko-KR', languages: ['ko-KR', 'ko'] });

// 로고(assets/logo.svg)에서 아이콘 파일을 만든다. 로고를 바꿨을 때만 실행: node scripts/make-icons.mjs
//  - assets/logo-512.png   설명서·문서용
//  - assets/favicon-192.png 브라우저 탭·휴대폰 홈 화면 아이콘용
//  - gas/09_FaviconData.js  favicon-192.png를 base64로 담은 서버 상수 (setupFavicon이 드라이브에 올림)
// sharp가 필요하다 (빌드·배포에는 쓰지 않으므로 프로젝트 의존성에 넣지 않음): npm i --no-save sharp
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('[make-icons] sharp가 없습니다. `npm i --no-save sharp`로 설치한 뒤 다시 실행하세요.');
  process.exit(1);
}

const svg = readFileSync(join(ROOT, 'assets', 'logo.svg'));
/** 64 단위 SVG를 size px로 (밀도를 올려 그린 뒤 줄여서 가장자리를 매끄럽게) */
const render = (size) => sharp(svg, { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const png512 = await render(512);
const png192 = await render(192);
writeFileSync(join(ROOT, 'assets', 'logo-512.png'), png512);
writeFileSync(join(ROOT, 'assets', 'favicon-192.png'), png192);

const b64 = png192.toString('base64');
const lines = b64.match(/.{1,100}/g).map((l) => `  '${l}'`).join(',\n');
writeFileSync(join(ROOT, 'gas', '09_FaviconData.js'), `/**
 * 파비콘 PNG (192×192) — 자동 생성 파일: node scripts/make-icons.mjs. 직접 고치지 말고 assets/logo.svg를 수정하세요.
 * setupFavicon()이 이 이미지를 드라이브에 올려 브라우저 탭 아이콘으로 쓴다. 설계: docs/design/favicon.md
 */
const FAVICON_PNG_BASE64_ = [
${lines},
].join('');
`);
console.log(`[make-icons] logo-512.png ${png512.length}B, favicon-192.png ${png192.length}B, 09_FaviconData.js (base64 ${b64.length}자)`);

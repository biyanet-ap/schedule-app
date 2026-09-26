// 빌드 산출물을 clasp가 올리는 gas/ 폴더로 복사한다.
//  - dist/index.html        → gas/index.html      (Vue 단일 파일 번들)
//  - config/appsscript.json → gas/appsscript.json (매니페스트 원본. clasp create-script가 gas/의 것을 덮어쓸 수 있어 원본을 따로 둔다)
import { copyFileSync, existsSync, statSync } from 'node:fs';

const pairs = [
  ['dist/index.html', 'gas/index.html'],
  ['config/appsscript.json', 'gas/appsscript.json'],
];
for (const [src, dest] of pairs) {
  if (!existsSync(src)) {
    console.error(`[copy-to-gas] ${src}이 없습니다.`);
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`[copy-to-gas] ${dest} (${Math.max(1, Math.round(statSync(dest).size / 1024))} KB)`);
}

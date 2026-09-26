// 다른 사람에게 전달할 패키지를 만든다: npm run release
//  1) 허용 목록의 소스만 release/schedule-app/ 로 복사 (.clasp.json·문서·node_modules 등 제외)
//  2) 브라우저만으로 설치할 수 있게 release/schedule-app/apps-script/ 에 3개 파일 생성
//  3) release.private.txt 의 패턴(내 이메일·회사명 등)이 하나라도 있으면 패키지를 지우고 실패
//  4) Windows면 release/schedule-app.zip 까지 만든다
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { concatGas, listReleaseFiles, parsePrivatePatterns, scanForPrivate } from './release-lib.mjs';

const ROOT = process.cwd();
const OUT_BASE = join(ROOT, 'release');
const OUT = join(OUT_BASE, 'schedule-app');
const ZIP = join(OUT_BASE, 'schedule-app.zip');
const PATTERN_FILE = join(ROOT, 'release.private.txt');

function fail(message) {
  console.error(`\n[release] 실패: ${message}`);
  process.exit(1);
}

if (!existsSync(PATTERN_FILE)) {
  fail('release.private.txt가 없습니다. 프로젝트 폴더에 이 파일을 만들고,\n'
    + '         전달 파일에 남으면 안 되는 문자열(내 이메일·회사명·프로젝트명 등)을 한 줄에 하나씩 적어 주세요.\n'
    + '         (# 로 시작하면 주석, re: 로 시작하면 정규식. 이 파일은 패키지에 들어가지 않습니다)');
}
const patterns = parsePrivatePatterns(readFileSync(PATTERN_FILE, 'utf8'));
if (patterns.length === 0) fail('release.private.txt에 검사할 패턴이 하나도 없습니다.');
if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/index.html이 없습니다. npm run build가 먼저 실행돼야 합니다.');

// 1) 소스 복사
rmSync(OUT_BASE, { recursive: true, force: true });
const files = listReleaseFiles(ROOT);
for (const f of files) {
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(ROOT, f), dest);
}

// 2) 브라우저 설치용 파일
const appsDir = join(OUT, 'apps-script');
mkdirSync(appsDir, { recursive: true });
const code = concatGas(ROOT);
try {
  new vm.Script(code, { filename: 'Code.gs' }); // 문법 확인
} catch (e) {
  rmSync(OUT_BASE, { recursive: true, force: true });
  fail('Code.gs 문법 오류: ' + e.message);
}
writeFileSync(join(appsDir, 'Code.gs'), code);
copyFileSync(join(ROOT, 'dist', 'index.html'), join(appsDir, 'index.html'));
copyFileSync(join(ROOT, 'config', 'appsscript.json'), join(appsDir, 'appsscript.json'));

// 3) 개인정보 검사 (패키지 안의 모든 파일)
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const full = join(dir, n);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const packaged = walk(OUT).map((full) => ({
  path: relative(OUT, full).split(sep).join('/'),
  content: readFileSync(full, 'utf8'),
}));
const hits = scanForPrivate(packaged, patterns);
if (hits.length) {
  rmSync(OUT_BASE, { recursive: true, force: true });
  console.error('\n[release] 전달하면 안 되는 문자열이 발견되어 패키지를 삭제했습니다:');
  for (const h of hits.slice(0, 50)) console.error(`  - ${h.path}${h.line ? ':' + h.line : ''}  ← ${h.pattern}`);
  fail(`${hits.length}건. 해당 파일을 고친 뒤 다시 실행해 주세요.`);
}

// 4) zip (Windows 10 이상 기본 tar는 zip을 만들 수 있다)
let zipped = false;
if (process.platform === 'win32' || process.platform === 'darwin') {
  const r = spawnSync('tar', ['-a', '-c', '-f', 'schedule-app.zip', 'schedule-app'], { cwd: OUT_BASE, stdio: 'ignore' });
  zipped = r.status === 0 && existsSync(ZIP);
}

console.log(`\n[release] 완료: 파일 ${packaged.length}개, 개인정보 검사 통과 (패턴 ${patterns.length}개)`);
console.log(`  폴더: ${relative(ROOT, OUT)}`);
console.log(zipped
  ? `  압축: ${relative(ROOT, ZIP)}  ← 이 파일을 전달하세요`
  : '  압축: 자동 생성 안 됨 → 탐색기에서 release/schedule-app 폴더를 우클릭 → "압축(ZIP) 폴더"로 보내기');

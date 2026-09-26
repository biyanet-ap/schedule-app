// 전달(배포) 패키지 공통 로직. 개인정보 검사 패턴은 이 파일에 넣지 않는다(패키지에 같이 나가므로).
// 패턴은 프로젝트 루트의 release.private.txt(전달 대상에서 항상 제외)에서 읽는다.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 전달 패키지에 넣는 항목 (허용 목록 방식: 여기 없는 것은 절대 나가지 않는다) */
export const SOURCE_ALLOWLIST = [
  'README.md', '.gitignore', '.clasp.json.example', 'index.html',
  'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'vite.config.ts', 'vitest.config.ts',
  'config/', 'src/', 'tests/', 'scripts/', 'assets/',
];

/** 허용 목록 안에 있더라도 절대 넣지 않는 파일 이름 (계정 연결 정보·검사 패턴) */
export const ALWAYS_EXCLUDED_NAMES = ['.clasp.json', '.clasprc.json', 'release.private.txt'];

const toPosix = (p) => p.split(sep).join('/');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** @returns {string[]} 루트 기준 상대 경로(/ 구분) */
export function listReleaseFiles(root) {
  const files = [];
  for (const entry of SOURCE_ALLOWLIST) {
    const full = join(root, entry);
    if (!existsSync(full)) continue;
    if (entry.endsWith('/')) files.push(...walk(full).map((f) => toPosix(relative(root, f))));
    else files.push(entry);
  }
  // 서버 코드는 원본 .js만 (gas/index.html, gas/appsscript.json은 빌드 산출물)
  const gasDir = join(root, 'gas');
  if (existsSync(gasDir)) {
    for (const f of readdirSync(gasDir).filter((n) => n.endsWith('.js')).sort()) files.push('gas/' + f);
  }
  return files.filter((f) => !ALWAYS_EXCLUDED_NAMES.includes(f.split('/').pop())).sort();
}

/** 브라우저 편집기 설치용: gas/*.js를 순서대로 이어 붙인 Code.gs (Apps Script는 모든 파일이 같은 전역 스코프라 결과가 같다) */
export function concatGas(root) {
  const gasDir = join(root, 'gas');
  const parts = readdirSync(gasDir).filter((n) => n.endsWith('.js')).sort().map((name) => {
    const code = readFileSync(join(gasDir, name), 'utf8');
    return `// ===== ${name} =====\n${code.trimEnd()}\n`;
  });
  return '// 스케줄관리 서버 코드 (자동 생성: npm run release). 직접 고치지 말고 gas/*.js를 수정하세요.\n\n' + parts.join('\n');
}

/**
 * release.private.txt 형식: 한 줄에 하나, 대소문자 무시 부분 일치.
 * '#'으로 시작하면 주석, 're:'로 시작하면 정규식 (예: re:\bandy\b)
 * @returns {{label: string, test: (s: string) => boolean}[]}
 */
export function parsePrivatePatterns(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    if (line.startsWith('re:')) {
      const re = new RegExp(line.slice(3), 'i');
      return { label: line, test: (s) => re.test(s) };
    }
    const needle = line.toLowerCase();
    return { label: line, test: (s) => s.toLowerCase().includes(needle) };
  });
}

/**
 * @param {{path: string, content: string}[]} files
 * @returns {{path: string, line: number, pattern: string}[]}
 */
export function scanForPrivate(files, patterns) {
  const hits = [];
  for (const { path, content } of files) {
    if (ALWAYS_EXCLUDED_NAMES.includes(path.split('/').pop())) hits.push({ path, line: 0, pattern: '(제외 대상 파일)' });
    // 파일 경로 자체에도 개인정보가 들어갈 수 있으므로 같이 검사
    for (const p of patterns) if (p.test(path)) hits.push({ path, line: 0, pattern: p.label });
    const lines = content.split(/\r?\n/);
    lines.forEach((l, i) => {
      for (const p of patterns) if (p.test(l)) hits.push({ path, line: i + 1, pattern: p.label });
    });
  }
  return hits;
}

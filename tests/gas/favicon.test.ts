/**
 * 브라우저 탭 아이콘(파비콘) v1.14. 설계: docs/design/favicon.md
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGas, createReadyGas } from './harness';

const ROOT = join(__dirname, '..', '..');

type Page = { file?: string; html?: string; faviconUrl?: string; title?: string };

describe('파비콘 주소 규칙', () => {
  const valid = (gas: ReturnType<typeof createGas>, url: unknown) => gas.raw('isValidFaviconUrl_', url);

  it('https로 시작하고 .png/.ico로 끝나는 주소만', () => {
    const gas = createGas();
    expect(valid(gas, 'https://example.com/icon.png')).toBe(true);
    expect(valid(gas, 'https://example.com/favicon.ICO')).toBe(true);
    expect(valid(gas, 'https://drive.google.com/uc?export=view&id=abc_-1&.png')).toBe(true);
    expect(valid(gas, 'http://example.com/icon.png')).toBe(false);
    expect(valid(gas, 'https://example.com/icon.svg')).toBe(false);
    expect(valid(gas, 'https://example.com/icon')).toBe(false);
    expect(valid(gas, 'data:image/png;base64,AAAA.png')).toBe(false);
    expect(valid(gas, 'javascript:alert(1)//.png')).toBe(false);
  });

  it('공백·따옴표·꺾쇠·역슬래시가 있거나 너무 길면 거부', () => {
    const gas = createGas();
    expect(valid(gas, 'https://example.com/a b.png')).toBe(false);
    expect(valid(gas, 'https://example.com/a".png')).toBe(false);
    expect(valid(gas, "https://example.com/a'.png")).toBe(false);
    expect(valid(gas, 'https://example.com/<x>.png')).toBe(false);
    expect(valid(gas, 'https://example.com/a\\b.png')).toBe(false);
    expect(valid(gas, '')).toBe(false);
    expect(valid(gas, null)).toBe(false);
  });

  it('길이는 2000자까지', () => {
    const gas = createGas();
    const base = 'https://example.com/';
    expect(valid(gas, base + 'a'.repeat(2000 - base.length - 4) + '.png')).toBe(true);
    expect(valid(gas, base + 'a'.repeat(2001 - base.length - 4) + '.png')).toBe(false);
  });

  it('제어 문자·ASCII 밖 문자·괄호·사용자 정보(user@host)는 거부', () => {
    const gas = createGas();
    expect(valid(gas, 'https://example.com/a\u0001.png')).toBe(false);
    expect(valid(gas, 'https://example.com/\u202egnp.png')).toBe(false);
    expect(valid(gas, 'https://example.com/로고.png')).toBe(false);
    expect(valid(gas, 'https://example.com/a(1).png')).toBe(false);
    expect(valid(gas, 'https://user:pass@example.com/a.png')).toBe(false);
    expect(valid(gas, 'https://evil.com@example.com/a.png')).toBe(false);
    expect(valid(gas, 'https:///a.png')).toBe(false);
    // 경로·쿼리 안의 @는 괜찮다
    expect(valid(gas, 'https://example.com/u/a@b/c.png')).toBe(true);
  });

  it('순서: 직접 지정(FAVICON_URL) → 드라이브 파일 → 없음', () => {
    const gas = createGas();
    expect(gas.raw('faviconUrl_')).toBeNull();
    gas.props.set('FAVICON_FILE_ID', 'abcDEF_123-x');
    expect(gas.raw('faviconUrl_')).toBe('https://drive.google.com/uc?export=view&id=abcDEF_123-x&.png');
    gas.props.set('FAVICON_URL', '  https://example.com/logo.png ');
    expect(gas.raw('faviconUrl_')).toBe('https://example.com/logo.png');
  });

  it('직접 지정 주소가 올바르지 않으면 쓰지 않고 드라이브 파일로 (경고 기록)', () => {
    const gas = createGas();
    gas.props.set('FAVICON_FILE_ID', 'abc');
    gas.props.set('FAVICON_URL', 'http://example.com/logo.png');
    expect(gas.raw('faviconUrl_')).toBe('https://drive.google.com/uc?export=view&id=abc&.png');
    expect(gas.state.logs.some((l) => l.includes('FAVICON_URL is invalid'))).toBe(true);
  });

  it('파일 ID 모양이 이상하면 주소를 만들지 않는다', () => {
    const gas = createGas();
    gas.props.set('FAVICON_FILE_ID', 'abc&x=1');
    expect(gas.raw('faviconUrl_')).toBeNull();
  });
});

describe('doGet에 탭 아이콘 붙이기', () => {
  it('설정 안 했으면 붙이지 않는다', () => {
    const gas = createReadyGas();
    const page = gas.raw('doGet') as Page;
    expect(page.file).toBe('index');
    expect(page.faviconUrl).toBeUndefined();
  });

  it('setupFavicon 뒤에는 정상 화면에 드라이브 주소를 붙인다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    const id = gas.props.get('FAVICON_FILE_ID');
    const page = gas.raw('doGet') as Page;
    expect(page.faviconUrl).toBe(`https://drive.google.com/uc?export=view&id=${id}&.png`);
  });

  it('setFaviconUrl이 오류를 내도 화면은 그대로 열린다', () => {
    const gas = createReadyGas();
    gas.props.set('FAVICON_URL', 'https://example.com/logo.png');
    gas.state.faviconThrows = true;
    const page = gas.raw('doGet') as Page;
    expect(page.file).toBe('index');
    expect(page.title).toBe('스케줄관리');
    expect(gas.state.logs.some((l) => l.includes('applyFavicon_'))).toBe(true);
  });

  it('권한 오류 페이지에는 붙이지 않는다', () => {
    const gas = createReadyGas();
    gas.props.set('FAVICON_URL', 'https://example.com/logo.png');
    gas.state.activeEmail = 'someone@example.org';
    const page = gas.raw('doGet') as Page;
    expect(page.html).toBeDefined();
    expect(page.faviconUrl).toBeUndefined();
  });
});

describe('setupFavicon', () => {
  it('로고 PNG를 드라이브에 만들고 링크 공유한 뒤 ID를 저장한다', () => {
    const gas = createReadyGas();
    const log = gas.call<string>('setupFavicon');
    const id = gas.props.get('FAVICON_FILE_ID')!;
    const file = gas.drive.files.find((f) => f.id === id)!;
    expect(file.name).toBe('스케줄관리_favicon.png');
    expect(file.sharing).toBe('ANYONE_WITH_LINK');
    expect(file.permission).toBe('VIEW'); // 편집 권한으로 공개하면 안 된다
    expect(file.content!.type).toBe('image/png');
    // PNG 머리 바이트와 크기(192×192)
    const b = Buffer.from(file.content!.bytes);
    expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(b.readUInt32BE(16)).toBe(192);
    expect(b.readUInt32BE(20)).toBe(192);
    expect(log).toContain('[OK] 파비콘 파일 만듦: 스케줄관리_favicon.png');
    expect(log).toContain('[OK] 링크 공유');
    expect(log).toContain(`https://drive.google.com/uc?export=view&id=${id}&.png`);
    expect(log).toContain('새로 고치면');
  });

  it('다시 실행하면 새 파일을 만들고 이전 파일은 휴지통으로 (쌓이지 않음)', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    const first = gas.props.get('FAVICON_FILE_ID')!;
    const log = gas.call<string>('setupFavicon');
    const second = gas.props.get('FAVICON_FILE_ID')!;
    expect(second).not.toBe(first);
    expect(gas.drive.files.find((f) => f.id === first)!.trashed).toBe(true);
    expect(gas.drive.files.find((f) => f.id === second)!.trashed).toBe(false);
    expect(gas.drive.files.filter((f) => f.name === '스케줄관리_favicon.png' && !f.trashed)).toHaveLength(1);
    expect(log).toContain('이전 파비콘 파일을 휴지통으로');
  });

  it('이전 파일이 이미 지워졌어도 멈추지 않는다', () => {
    const gas = createReadyGas();
    gas.props.set('FAVICON_FILE_ID', 'gone-id');
    const log = gas.call<string>('setupFavicon');
    expect(gas.props.get('FAVICON_FILE_ID')).not.toBe('gone-id');
    expect(log).toContain('[OK] 파비콘 파일 만듦');
  });

  it('새 파일을 못 만들면 이전 파일과 ID는 그대로', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    const first = gas.props.get('FAVICON_FILE_ID')!;
    gas.drive.createFileThrows = true;
    expect(() => gas.raw('setupFavicon')).toThrow('Drive createFile failed');
    expect(gas.props.get('FAVICON_FILE_ID')).toBe(first);
    expect(gas.drive.files.find((f) => f.id === first)!.trashed).toBe(false);
  });

  it('공유가 막혀 있으면 경고만 남기고 파일·ID는 저장', () => {
    const gas = createReadyGas();
    gas.drive.sharingThrows = true;
    const log = gas.call<string>('setupFavicon');
    const id = gas.props.get('FAVICON_FILE_ID')!;
    expect(gas.drive.files.find((f) => f.id === id)!.sharing).toBe('PRIVATE');
    expect(log).toContain('[WARN] 링크 공유를 켜지 못했습니다');
    expect(log).toContain('Sharing is restricted');
    expect(log).not.toContain('[OK] 링크 공유');
    expect(log).toContain('안 보일 수 있습니다');
    expect(log).not.toContain('새로 고치면 탭 아이콘이 바뀝니다');
  });

  it('다시 실행했는데 공유만 실패하면, 잘 되던 이전 파일을 그대로 쓰고 새 파일을 치운다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    const first = gas.props.get('FAVICON_FILE_ID')!;
    gas.drive.sharingThrows = true;
    const log = gas.call<string>('setupFavicon');
    expect(gas.props.get('FAVICON_FILE_ID')).toBe(first);
    expect(gas.drive.files.find((f) => f.id === first)!.trashed).toBe(false);
    const extra = gas.drive.files.filter((f) => f.name === '스케줄관리_favicon.png' && f.id !== first);
    expect(extra).toHaveLength(1);
    expect(extra[0].trashed).toBe(true);
    expect(log).toContain('이전 파일을 그대로 씁니다');
    expect(log).toContain(`id=${first}&.png`);
  });

  it('저장된 ID가 이 앱의 로고 파일이 아니면(속성을 손으로 고친 경우) 그 파일은 휴지통으로 보내지 않는다', () => {
    const gas = createReadyGas();
    const dbId = gas.props.get('SPREADSHEET_ID')!;
    gas.props.set('FAVICON_FILE_ID', dbId);
    const log = gas.call<string>('setupFavicon');
    expect(gas.drive.files.find((f) => f.id === dbId)!.trashed).toBe(false);
    expect(gas.props.get('FAVICON_FILE_ID')).not.toBe(dbId);
    expect(log).toContain(`[WARN] 이전에 저장된 파일(${dbId})은 이 앱이 만든 로고 파일이 아니라서 그대로 둡니다`);
  });

  it('이전 파일을 휴지통으로 못 옮기면 로그에 알린다 (새 파일은 그대로 사용)', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    const first = gas.props.get('FAVICON_FILE_ID')!;
    gas.drive.trashThrowsIds.add(first);
    const log = gas.call<string>('setupFavicon');
    expect(gas.props.get('FAVICON_FILE_ID')).not.toBe(first);
    expect(log).toContain(`[WARN] 이전 파비콘 파일(${first})을 휴지통으로 옮기지 못했습니다`);
  });

  it('이전 파일이 이미 휴지통에 있으면 옮겼다는 줄이 없다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    gas.drive.files.find((f) => f.id === gas.props.get('FAVICON_FILE_ID'))!.trashed = true;
    expect(gas.call<string>('setupFavicon')).not.toContain('휴지통으로 옮김');
  });

  it('직접 지정 주소가 있으면 그것을 먼저 쓴다고 알려 준다', () => {
    const gas = createReadyGas();
    gas.props.set('FAVICON_URL', 'https://example.com/logo.png');
    expect(gas.call<string>('setupFavicon')).toContain('FAVICON_URL이 있어 그 주소를 먼저 씁니다: https://example.com/logo.png');
    gas.props.set('FAVICON_URL', 'not a url');
    expect(gas.call<string>('setupFavicon')).toContain('FAVICON_URL 값이 올바르지 않아');
  });

  it('소유자가 아니거나 setup 전이면 실행하지 않는다', () => {
    const gas = createGas();
    expect(() => gas.raw('setupFavicon')).toThrow(expect.objectContaining({ code: 'NOT_INITIALIZED' }));
    expect(gas.drive.files.some((f) => f.name === '스케줄관리_favicon.png')).toBe(false);
    const ready = createReadyGas();
    ready.state.activeEmail = 'someone@example.org';
    expect(() => ready.raw('setupFavicon')).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(ready.drive.files.some((f) => f.name === '스케줄관리_favicon.png')).toBe(false);
  });

  it('일본어 계정이면 로그도 일본어', () => {
    const gas = createReadyGas();
    gas.state.activeLocale = 'ja';
    const log = gas.call<string>('setupFavicon');
    expect(log).toContain('[OK] ファビコンのファイルを作成: 스케줄관리_favicon.png');
    expect(log).toContain('再読み込みすると');
    expect(log.split('스케줄관리_favicon.png').join('')).not.toMatch(/[가-힣]/);
  });
});

describe('runSelfTest 파비콘 줄', () => {
  const line = (log: string) => log.split('\n').find((l) => l.includes('파비콘'));

  it('설정 안 함 → 선택 안내', () => {
    const gas = createReadyGas();
    expect(line(gas.call<string>('runSelfTest'))).toBe('[OK] 파비콘: 설정 안 함 (선택 — setupFavicon을 실행하면 탭 아이콘이 생깁니다)');
  });

  it('파일 있음 + 링크 공유 → OK', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    expect(line(gas.call<string>('runSelfTest'))).toBe('[OK] 파비콘: 스케줄관리_favicon.png (링크 공유)');
  });

  it('공유 안 됨 → 경고', () => {
    const gas = createReadyGas();
    gas.drive.sharingThrows = true;
    gas.call('setupFavicon');
    expect(line(gas.call<string>('runSelfTest'))).toContain('[WARN] 파비콘: 링크 공유가 꺼져');
  });

  it('파일이 휴지통에 있거나 없음 → 다시 실행 안내', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    gas.drive.files.find((f) => f.id === gas.props.get('FAVICON_FILE_ID'))!.trashed = true;
    expect(line(gas.call<string>('runSelfTest'))).toContain('setupFavicon을 다시 실행');
    gas.props.set('FAVICON_FILE_ID', 'gone-id');
    expect(line(gas.call<string>('runSelfTest'))).toContain('setupFavicon을 다시 실행');
  });

  it('직접 지정 주소 → 올바르면 OK, 아니면 경고', () => {
    const gas = createReadyGas();
    gas.props.set('FAVICON_URL', 'https://example.com/logo.png');
    expect(line(gas.call<string>('runSelfTest'))).toBe('[OK] 파비콘: 직접 지정한 주소(FAVICON_URL) 사용');
    gas.props.set('FAVICON_URL', 'https://example.com/logo.svg');
    expect(line(gas.call<string>('runSelfTest'))).toContain('[WARN] 파비콘: FAVICON_URL 값이 올바르지 않아');
  });

  it('직접 지정 주소가 잘못됐으면 실제로 쓰이는 드라이브 파일 상태도 함께 알린다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    gas.props.set('FAVICON_URL', 'nope');
    const lines = gas.call<string>('runSelfTest').split('\n').filter((l) => l.includes('파비콘'));
    expect(lines).toEqual([
      expect.stringContaining('[WARN] 파비콘: FAVICON_URL 값이 올바르지 않아'),
      '[OK] 파비콘: 스케줄관리_favicon.png (링크 공유)',
    ]);
  });

  it('「모든 사용자(ANYONE)」 공유도 공유된 것으로 본다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    gas.drive.files.find((f) => f.id === gas.props.get('FAVICON_FILE_ID'))!.sharing = 'ANYONE';
    expect(line(gas.call<string>('runSelfTest'))).toBe('[OK] 파비콘: 스케줄관리_favicon.png (링크 공유)');
  });

  it('공유 상태를 못 읽으면 그 줄만 [FAIL]이고 점검은 끝까지 돈다', () => {
    const gas = createReadyGas();
    gas.call('setupFavicon');
    gas.drive.sharingReadThrows = true;
    const log = gas.call<string>('runSelfTest');
    expect(line(log)).toContain('[FAIL] 파비콘: Drive getSharingAccess failed');
    expect(log).toContain('[OK] 트리거');
  });
});

describe('로고 사본이 원본(assets/logo.svg)과 같다', () => {
  /** <rect …/>·<path …/> 요소를 속성 정렬한 문자열 목록으로 */
  const shapes = (svg: string) => [...svg.matchAll(/<(rect|path)\s([^>]*?)\/?>/g)].map(([, tag, attrs]) => tag + ' '
    + [...attrs.matchAll(/([a-z-]+)=["']([^"']*)["']/g)].map(([, k, v]) => `${k}=${v}`).sort().join(' '));
  const original = shapes(readFileSync(join(ROOT, 'assets', 'logo.svg'), 'utf8'));

  it('원본은 사각형 3개 + 경로 2개', () => {
    expect(original).toHaveLength(5);
  });

  it('머리글 컴포넌트(AppLogo.vue)는 같은 모양이고 스크린 리더에서 숨김', () => {
    const vue = readFileSync(join(ROOT, 'src', 'components', 'AppLogo.vue'), 'utf8');
    expect(shapes(vue)).toEqual(original);
    expect(vue).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(vue).toMatch(/<svg[^>]*focusable="false"/);
    expect(vue).not.toMatch(/\sid=/); // 여러 번 써도 id가 겹치지 않게
  });

  it('개발 화면 탭 아이콘(index.html data URI)도 같은 모양', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const href = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)"/.exec(html)![1];
    expect(shapes(decodeURIComponent(href))).toEqual(original);
  });

  it('서버의 PNG 데이터는 assets/favicon-192.png와 같다', () => {
    const gas = createGas();
    const b64 = gas.eval('FAVICON_PNG_BASE64_') as string;
    expect(Buffer.from(b64, 'base64').equals(readFileSync(join(ROOT, 'assets', 'favicon-192.png')))).toBe(true);
  });
});

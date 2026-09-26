/** 검색어가 들어간 부분을 앞뒤로 조금 잘라 보여준다. (텍스트로만 출력, HTML 삽입 없음) */
export function snippet(text: string, keyword: string): string {
  if (!text) return '';
  const i = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (i < 0) return text.slice(0, 80) + (text.length > 80 ? '…' : '');
  const start = Math.max(0, i - 30);
  const end = Math.min(text.length, i + keyword.length + 50);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

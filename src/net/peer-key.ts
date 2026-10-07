/** 브라우저 탭마다 하나씩 쓰는 이름표. */
export function makePeerKey(rand: () => number = Math.random): string {
  let key = '';
  for (let i = 0; i < 16; i++) key += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)];
  return key;
}

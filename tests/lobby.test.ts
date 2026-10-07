import { describe, expect, it } from 'vitest';
import {
  botColors,
  cleanName,
  makeRoomCode,
  matchProgress,
  parseRoomCode,
  pickHost,
  resolveColor,
  roomName,
  seatOrder,
} from '../src/game/lobby';
import type { Seat } from '../src/game/lobby';
import type { Phase } from '../src/game/round';

const seat = (peer: string, since: number, color = 0, hosting = false): Seat => ({ peer, since, color, hosting });

describe('방 코드', () => {
  it('다섯 글자를 만들고 다시 읽을 수 있습니다', () => {
    let i = 0;
    const code = makeRoomCode(() => (i++ % 10) / 10);
    expect(code).toHaveLength(5);
    expect(parseRoomCode(code)).toBe(code);
    expect(roomName(code)).toBe(`ba-${code}`);
  });

  it('초대 링크에서 코드를 꺼냅니다', () => {
    expect(parseRoomCode('https://x/#abcde')).toBe('abcde');
    expect(parseRoomCode(' ABCDE ')).toBe('abcde');
    expect(parseRoomCode('abc0e')).toBeNull();
    expect(parseRoomCode('abcd')).toBeNull();
  });
});

describe('cleanName', () => {
  it('제어 문자를 지우고 12자로 자릅니다', () => {
    expect(cleanName('a\u0000b​c')).toBe('abc');
    expect(cleanName('가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타');
  });
  it('문자열이 아니거나 비면 기본 이름입니다', () => {
    expect(cleanName(3)).toBe('플레이어');
    expect(cleanName('  ')).toBe('플레이어');
    expect(cleanName(null, '손님')).toBe('손님');
  });
});

describe('seatOrder', () => {
  it('since, peer 순으로 늘어놓고 원본은 그대로 둡니다', () => {
    const list = [seat('c', 2), seat('b', 1), seat('a', 2)];
    expect(seatOrder(list).map((s) => s.peer)).toEqual(['b', 'a', 'c']);
    expect(list[0].peer).toBe('c');
  });
});

describe('pickHost', () => {
  it('아무도 hosting이 아니면 가장 앞사람입니다', () => {
    expect(pickHost([seat('b', 2), seat('a', 1)])).toBe('a');
  });
  it('뒤에 온 사람만 hosting이면 그 사람입니다', () => {
    expect(pickHost([seat('a', 1), seat('b', 2, 0, true)])).toBe('b');
  });
  it('둘이 hosting이면 앞사람입니다', () => {
    expect(pickHost([seat('a', 1, 0, true), seat('b', 2, 0, true)])).toBe('a');
  });
  it('빈 목록이면 null입니다', () => {
    expect(pickHost([])).toBeNull();
  });
  it('둘이 hosting이면 경기가 더 많이 진행된 사람입니다', () => {
    const seats = [{ ...seat('a', 1, 0, true), progress: 100100 }, { ...seat('b', 2, 0, true), progress: 100201 }];
    expect(pickHost(seats)).toBe('b');
  });
  it('진행된 정도가 같으면 앞사람입니다', () => {
    const seats = [{ ...seat('b', 2, 0, true), progress: 100201 }, { ...seat('a', 1, 0, true), progress: 100201 }];
    expect(pickHost(seats)).toBe('a');
  });
  it('hosting이 아닌 사람의 progress는 보지 않습니다', () => {
    expect(pickHost([{ ...seat('a', 1), progress: 999 }, seat('b', 2, 0, true)])).toBe('b');
  });
});

describe('matchProgress', () => {
  const match = (game: number, round: number, scores: Record<string, number> = {}, phase: Phase = 'play') => ({
    game,
    round,
    scores,
    phase,
  });
  it('경기 번호, 라운드, 점수 합의 순서로 커집니다', () => {
    expect(matchProgress(match(1, 2, { a: 1, b: 2 }))).toBe(100203);
    expect(matchProgress(match(2, 1))).toBeGreaterThan(matchProgress(match(1, 9, { a: 7, b: 6 })));
    expect(matchProgress(match(1, 3))).toBeGreaterThan(matchProgress(match(1, 2, { a: 7, b: 7, c: 7 })));
    expect(matchProgress(match(1, 2, { a: 2 }))).toBeGreaterThan(matchProgress(match(1, 2, { a: 1 })));
  });
  it('점수 합은 99까지만 셉니다', () => {
    expect(matchProgress(match(1, 1, { a: 99, b: 99 }))).toBe(100199);
  });
  it('라운드는 999까지만 세어서 다음 경기를 넘지 않습니다', () => {
    expect(matchProgress(match(1, 5000))).toBe(199900);
    expect(matchProgress(match(2, 1, {}, 'countdown'))).toBeGreaterThan(matchProgress(match(1, 5000, { a: 99 })));
  });
  it('대기실은 같은 경기 번호의 어떤 경기 중 상태보다 앞서고 다음 경기보다는 뒤입니다', () => {
    const lobby = matchProgress(match(1, 0, {}, 'lobby'));
    expect(matchProgress(match(0, 0, {}, 'lobby'))).toBe(99999);
    expect(lobby).toBe(199999);
    for (const phase of ['countdown', 'play', 'roundEnd', 'matchEnd'] as const) {
      expect(lobby).toBeGreaterThan(matchProgress(match(1, 9, { a: 7, b: 6 }, phase)));
    }
    expect(matchProgress(match(2, 1, {}, 'countdown'))).toBeGreaterThan(lobby);
  });
});

describe('resolveColor', () => {
  it('겹치지 않으면 그대로입니다', () => {
    expect(resolveColor([seat('a', 1, 0), seat('b', 2, 1)], 'b')).toBe(1);
  });
  it('앞사람과 겹치면 빈 색 가운데 가장 앞 번호입니다', () => {
    expect(resolveColor([seat('a', 1, 0), seat('c', 3, 1), seat('b', 2, 0)], 'b')).toBe(2);
  });
  it('뒷사람과 겹치면 그대로입니다', () => {
    expect(resolveColor([seat('a', 1, 0), seat('b', 2, 0)], 'a')).toBe(0);
  });
});

describe('botColors', () => {
  it('사람이 쓰지 않는 색을 앞에서부터 고릅니다', () => {
    expect(botColors([0, 2], 3)).toEqual([1, 3, 4]);
  });
});

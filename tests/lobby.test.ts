import { describe, expect, it } from 'vitest';
import { botColors, cleanName, makeRoomCode, parseRoomCode, pickHost, resolveColor, roomName, seatOrder } from '../src/game/lobby';
import type { Seat } from '../src/game/lobby';

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

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, advance, botIds, isBot, lobbyMatch, startMatch, toLobby } from '../src/game/round';
import type { Match } from '../src/game/round';

const rnd = () => 0.3;
const started = (settings = DEFAULT_SETTINGS): Match => startMatch(lobbyMatch(settings), ['a', 'b', 'c'], rnd);
const playing = (settings = DEFAULT_SETTINGS): Match => advance(started(settings), 3000, [], [], rnd);

describe('startMatch', () => {
  it('카운트다운으로 들어가고 점수는 모두 0입니다', () => {
    const m = started();
    expect(m.phase).toBe('countdown');
    expect(m.round).toBe(1);
    expect(m.game).toBe(1);
    expect(m.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(m.roster).toEqual(['a', 'b', 'c']);
  });

  it('한 명으로는 시작되지 않습니다', () => {
    const lobby = lobbyMatch(DEFAULT_SETTINGS);
    expect(startMatch(lobby, ['a'], rnd)).toBe(lobby);
  });
});

describe('advance', () => {
  it('3000ms에 play로 넘어갑니다', () => {
    const m = advance(started(), 2999, [], [], rnd);
    expect(m.phase).toBe('countdown');
    const p = advance(m, 1, [], [], rnd);
    expect(p.phase).toBe('play');
    expect(p.ms).toBe(0);
  });

  it('생존자가 한 명이면 그 사람이 이기고 1점을 받습니다', () => {
    const m = advance(playing(), 16, ['a'], [], rnd);
    expect(m.phase).toBe('roundEnd');
    expect(m.winner).toBe('a');
    expect(m.scores.a).toBe(1);
  });

  it('생존자가 없으면 무승부이고 점수가 그대로입니다', () => {
    const m = advance(playing(), 16, [], [], rnd);
    expect(m.phase).toBe('roundEnd');
    expect(m.winner).toBeNull();
    expect(m.scores).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('roster에 없는 id는 생존자로 세지 않습니다', () => {
    const m = advance(playing(), 16, ['a', 'zzz'], [], rnd);
    expect(m.phase).toBe('roundEnd');
    expect(m.winner).toBe('a');
  });

  it('둘 이상 살아 있으면 계속 진행합니다', () => {
    const m = advance(playing(), 16, ['a', 'b'], [], rnd);
    expect(m.phase).toBe('play');
    expect(m.ms).toBe(16);
  });

  it('90000ms가 지나면 무승부입니다', () => {
    const m = advance(playing(), 90000, ['a', 'b'], [], rnd);
    expect(m.phase).toBe('roundEnd');
    expect(m.winner).toBeNull();
  });

  it('roundEnd 2000ms 뒤 다음 라운드 카운트다운으로 가며 맵이 바뀝니다', () => {
    const end = advance(playing(), 16, ['a'], [], rnd);
    const wait = advance(end, 1999, [], ['a', 'b', 'c'], rnd);
    expect(wait.phase).toBe('roundEnd');
    const next = advance(wait, 1, [], ['a', 'b', 'c'], rnd);
    expect(next.phase).toBe('countdown');
    expect(next.round).toBe(2);
    expect(next.map).not.toBe(end.map);
  });

  it('새로 들어온 id는 roster와 scores에 들어갑니다', () => {
    const end = advance(playing(), 16, ['a'], [], rnd);
    const next = advance(end, 2000, [], ['a', 'b', 'c', 'd'], rnd);
    expect(next.roster).toEqual(['a', 'b', 'c', 'd']);
    expect(next.scores.d).toBe(0);
    expect(next.scores.a).toBe(1);
  });

  it('목표 점수에 닿으면 matchEnd입니다', () => {
    const settings = { ...DEFAULT_SETTINGS, target: 3 };
    let m = playing(settings);
    m = { ...m, scores: { a: 2, b: 0, c: 0 } };
    m = advance(m, 16, ['a'], [], rnd);
    expect(m.scores.a).toBe(3);
    m = advance(m, 2000, [], ['a', 'b', 'c'], rnd);
    expect(m.phase).toBe('matchEnd');
    expect(m.winner).toBe('a');
  });

  it('입력 객체를 바꾸지 않습니다', () => {
    const m = playing();
    const frozen = Object.freeze({ ...m, scores: Object.freeze({ ...m.scores }), roster: Object.freeze([...m.roster]) });
    const end = advance(frozen as Match, 16, ['a'], [], rnd);
    expect(end).not.toBe(frozen);
    expect(frozen.scores.a).toBe(0);
    expect(frozen.phase).toBe('play');
    expect(() => advance(end, 2000, [], ['a', 'b'], rnd)).not.toThrow();
  });
});

describe('toLobby', () => {
  it('설정과 경기 번호를 유지하고 대기실로 돌아갑니다', () => {
    const m = toLobby(playing());
    expect(m.phase).toBe('lobby');
    expect(m.settings).toBe(DEFAULT_SETTINGS);
    expect(m.game).toBe(1);
  });
});

describe('AI id', () => {
  it('botIds와 isBot', () => {
    expect(botIds(2)).toEqual(['bot1', 'bot2']);
    expect(isBot('bot1')).toBe(true);
    expect(isBot('a')).toBe(false);
  });
});

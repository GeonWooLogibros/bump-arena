import { describe, expect, it } from 'vitest';
import { fitView } from '../src/render/scene';

describe('fitView', () => {
  it('16:9 창에서는 꽉 채운다', () => {
    expect(fitView(1600, 900)).toEqual({ scale: 50, offsetX: 0, offsetY: 0 });
  });

  it('세로로 긴 창에서는 가로에 맞추고 세로 가운데에 둔다', () => {
    expect(fitView(1000, 1000)).toEqual({ scale: 31.25, offsetX: 0, offsetY: 218.75 });
  });

  it('가로로 긴 창에서는 세로에 맞추고 가로 가운데에 둔다', () => {
    expect(fitView(2000, 900)).toEqual({ scale: 50, offsetX: 200, offsetY: 0 });
  });

  it('크기가 0인 창에서도 숫자를 돌려준다', () => {
    expect(fitView(0, 0)).toEqual({ scale: 0, offsetX: 0, offsetY: 0 });
  });
});

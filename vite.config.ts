import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 공개 사이트를 GitHub Pages처럼 하위 경로에 올려도 파일을 찾을 수 있게 상대 경로를 씁니다.
  base: './',
  test: {
    // 물리를 수백 걸음 진행하는 테스트가 있어서 넉넉히 둡니다.
    testTimeout: 20000,
  },
});

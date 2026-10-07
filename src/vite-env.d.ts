/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 공개 사이트에서 쓸 연결 방식. 'p2p'면 브라우저끼리 직접 연결합니다. claude.ai용 빌드에는 넣지 않습니다. */
  readonly VITE_NET?: 'p2p';
}

/** 소리 파일을 빌드 결과의 JS 안에 data URL로 넣습니다. */
declare module '*.mp3?inline' {
  const url: string;
  export default url;
}

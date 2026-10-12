/** 효과음. Kenney(www.kenney.nl)의 Impact Sounds와 Interface Sounds(CC0)를 사용합니다. */
import click from './sounds/click.mp3?inline';
import go from './sounds/go.mp3?inline';
import hit from './sounds/hit.mp3?inline';
import jump from './sounds/jump.mp3?inline';
import out from './sounds/out.mp3?inline';
import rope from './sounds/rope.mp3?inline';
import shoot from './sounds/shoot.mp3?inline';
import stick from './sounds/stick.mp3?inline';
import tick from './sounds/tick.mp3?inline';
import win from './sounds/win.mp3?inline';

export type SoundName = 'hit' | 'out' | 'shoot' | 'stick' | 'rope' | 'jump' | 'tick' | 'go' | 'win' | 'click';

export interface Sound {
  muted: boolean;
  /** 브라우저는 사용자가 누른 뒤에만 소리를 낼 수 있으므로, 버튼이나 키를 눌렀을 때 부릅니다. */
  unlock(): void;
  /** 소리를 켜거나 끄고, 바뀐 뒤에 꺼져 있는지를 돌려줍니다. */
  toggle(): boolean;
  /** 효과음을 냅니다. volume은 0~1이고, rate는 빠르기입니다. 1보다 크면 높은 소리가 납니다. */
  play(name: SoundName, volume?: number, rate?: number): void;
}

const FILES: Record<SoundName, string> = { hit, out, shoot, stick, rope, jump, tick, go, win, click };

/** 충돌 소리를 다시 내기까지 두는 간격(초)입니다. */
const HIT_GAP = 0.05;

/** 빌드에 넣어 둔 소리 파일의 내용을 꺼냅니다. */
async function read(url: string): Promise<ArrayBuffer> {
  const mark = ';base64,';
  const at = url.startsWith('data:') ? url.indexOf(mark) : -1;
  if (at < 0) return (await fetch(url)).arrayBuffer();
  // 통신을 막아 둔 환경에서도 읽을 수 있게 직접 풉니다.
  const text = atob(url.slice(at + mark.length));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

/** 효과음을 준비합니다. 소리를 낼 수 없는 환경에서는 아무 일도 하지 않습니다. */
export function createAudio(): Sound {
  let context: AudioContext | null = null;
  let loading = false;
  let lastHit = -Infinity;
  const buffers = new Map<SoundName, AudioBuffer>();

  const load = (ctx: AudioContext): void => {
    for (const name of Object.keys(FILES) as SoundName[]) {
      read(FILES[name])
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        // 불러오지 못한 소리는 내지 않고 진행하되, 원인을 찾을 수 있게 알립니다. 소리마다 한 번만 불러옵니다.
        .catch((error: unknown) => console.warn(`소리를 불러오지 못했습니다: ${name}`, error));
    }
  };

  const sound: Sound = {
    muted: false,
    unlock() {
      try {
        context ??= new AudioContext();
        void context.resume();
      } catch {
        context = null;
        return;
      }
      if (loading) return;
      loading = true;
      load(context);
    },
    toggle() {
      sound.muted = !sound.muted;
      return sound.muted;
    },
    play(name, volume = 1, rate = 1) {
      const buffer = buffers.get(name);
      if (sound.muted || !context || !buffer) return;
      if (name === 'hit') {
        if (context.currentTime - lastHit < HIT_GAP) return;
        lastHit = context.currentTime;
      }
      try {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        gain.gain.value = Math.max(0, Math.min(1, volume));
        source.connect(gain).connect(context.destination);
        source.start();
      } catch {
        // 소리를 낼 수 없는 환경에서는 소리 없이 진행합니다.
      }
    },
  };
  return sound;
}

import { COLORS, MAX_PLAYERS, NAME_LIMIT } from '../game/lobby';
import { MAPS, RANDOM_MAP } from '../game/maps';
import { MODES, TARGETS } from '../game/modes';
import type { Settings } from '../game/round';
import type { LobbyView } from '../multiplayer';

/** 처음 화면, 대기실, 경기 중 버튼, 최종 결과. 버튼이 눌리면 넘겨받은 함수를 부르기만 하고 게임 상태를 직접 바꾸지 않습니다. */

/** 최종 결과의 점수표 한 줄입니다. */
export interface ResultRow {
  name: string;
  fill: string;
  edge: string;
  score: number;
  me: boolean;
}

export type MenuView =
  | {
      kind: 'title';
      name: string;
      color: number;
      code: string;
      /** 같이 하기에 연결하는 중인지, 쓸 수 있는지, 쓸 수 없는지. */
      multi: 'connecting' | 'ready' | 'none';
      busy: boolean;
      error: string | null;
    }
  /** copy는 초대 링크 복사의 결과입니다. 잠깐 보여 준 뒤 idle로 돌아갑니다. */
  | { kind: 'lobby'; view: LobbyView; copy: 'idle' | 'done' | 'failed' }
  | { kind: 'play'; muted: boolean }
  /** winner는 우승자의 이름입니다. 우승자 없이 끝났으면 null입니다. */
  | { kind: 'result'; winner: string | null; rows: ResultRow[]; isHost: boolean };

export interface MenuActions {
  practice(name: string, color: number): void;
  create(name: string, color: number): void;
  join(code: string, name: string, color: number): void;
  /** 처음 화면에서 색을 고릅니다. */
  pickColor(color: number): void;
  /** 대기실에서 내 색을 바꿉니다. */
  color(color: number): void;
  /** 방장이 대기실에서 설정을 바꿉니다. */
  settings(patch: Partial<Settings>): void;
  ready(): void;
  start(): void;
  /** 초대 링크를 복사합니다. */
  copy(invite: string): void;
  /** 최종 결과에서 대기실로 돌아갑니다. */
  lobby(): void;
  sound(): void;
  leave(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // 다른 사람이 보낸 이름도 여기로 들어오므로 반드시 textContent로 넣습니다.
  if (text) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => {
    // 초점이 버튼에 남아 있으면 스페이스가 특수 동작 대신 이 버튼을 다시 누르게 됩니다.
    node.blur();
    onClick();
  });
  return node;
}

/** 공 색의 작은 원입니다. */
function dot(fill: string, edge: string, className = 'dot'): HTMLSpanElement {
  const node = el('span', className);
  node.style.background = fill;
  node.style.borderColor = edge;
  return node;
}

/** 색 여섯 개 가운데 하나를 고르는 줄입니다. taken은 고를 수 없는 색입니다. */
function swatches(selected: number, taken: readonly number[], onPick: (color: number) => void): HTMLElement {
  const row = el('div', 'swatches');
  COLORS.forEach((color, i) => {
    const node = button('', () => onPick(i), i === selected ? 'swatch on' : 'swatch');
    node.style.background = color.fill;
    node.style.borderColor = color.edge;
    node.setAttribute('aria-label', color.name);
    node.title = color.name;
    node.disabled = i !== selected && taken.includes(i);
    row.append(node);
  });
  return row;
}

function labeled(label: string, ...content: HTMLElement[]): HTMLElement {
  const wrap = el('div', 'labeled');
  wrap.append(el('span', 'label', label), ...content);
  return wrap;
}

/** 여러 값 가운데 하나를 고르는 버튼 줄입니다. */
function options<T>(
  items: readonly { value: T; label: string }[],
  selected: T,
  enabled: boolean,
  onPick: (value: T) => void,
): HTMLElement {
  const row = el('div', 'options');
  for (const item of items) {
    const node = button(item.label, () => onPick(item.value), item.value === selected ? 'option on' : 'option');
    node.disabled = !enabled;
    row.append(node);
  }
  return row;
}

export function createMenus(root: HTMLElement, actions: MenuActions): { show(view: MenuView): void } {
  const layer = el('div', 'menus');
  root.append(layer);
  let lastKey = '';
  let lastKind = '';
  // 화면을 다시 만들어도 입력하던 글자가 사라지지 않게 따로 기억합니다.
  let typedName: string | null = null;
  let typedCode: string | null = null;

  function title(view: Extract<MenuView, { kind: 'title' }>): HTMLElement {
    const panel = el('div', 'panel');
    const online = view.multi === 'ready';

    const name = el('input', 'field');
    name.maxLength = NAME_LIMIT;
    name.placeholder = '비워 두면 플레이어로 표시됩니다';
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.dataset.focus = 'name';
    name.value = typedName ?? view.name;
    name.addEventListener('input', () => (typedName = name.value));

    const code = el('input', 'field code-input');
    code.maxLength = 80;
    code.placeholder = '방 코드';
    code.autocapitalize = 'characters';
    code.autocomplete = 'off';
    code.spellcheck = false;
    code.dataset.focus = 'code';
    code.value = typedCode ?? view.code;
    code.disabled = !online;
    code.addEventListener('input', () => (typedCode = code.value));

    const practice = button('연습하기', () => actions.practice(name.value, view.color), 'btn primary');
    const create = button('방 만들기', () => actions.create(name.value, view.color));
    const join = button('방 들어가기', () => actions.join(code.value, name.value, view.color));
    practice.disabled = view.busy;
    create.disabled = join.disabled = view.busy || !online;
    code.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join.click();
    });

    const starts = el('div', 'pair');
    starts.append(practice, create);
    const joining = el('div', 'pair');
    joining.append(code, join);

    panel.append(
      el('h1', 'title brand', '통통 대전'),
      el('p', 'sub', '공으로 상대를 밀어내는 대전 게임입니다.'),
      labeled('이름', name),
      labeled(
        '색',
        swatches(view.color, [], (color) => actions.pickColor(color)),
      ),
      starts,
      joining,
    );
    if (view.busy) panel.append(el('p', 'hint', '방에 들어가는 중입니다.'));
    else if (view.multi === 'connecting') panel.append(el('p', 'hint', '연결하는 중입니다.'));
    else if (view.multi === 'none') panel.append(el('p', 'hint', '이 환경에서는 연습하기만 할 수 있습니다.'));
    if (view.error) panel.append(el('p', 'error', view.error));

    const guide = el('dl', 'guide');
    guide.append(
      el('dt', '', '방향키 또는 WASD'),
      el('dd', '', '이동과 뛰기'),
      el('dt', '', 'X 또는 스페이스'),
      el('dd', '', '특수 동작'),
    );
    panel.append(guide);
    return panel;
  }

  function lobby({ view, copy }: Extract<MenuView, { kind: 'lobby' }>): HTMLElement {
    const panel = el('div', 'panel lobby');
    const { settings } = view;
    const canEdit = view.isHost && view.settled;

    const people = el('div', 'column');
    people.append(el('h1', 'title', view.practice ? '연습 대기실' : '대기실'));
    if (!view.practice) {
      const ticket = el('div', 'ticket');
      const codeBox = el('div', 'ticket-code');
      codeBox.append(el('span', 'label', '방 코드'), el('strong', 'code', view.code.toUpperCase()));
      const label = copy === 'done' ? '복사 완료' : '초대 링크 복사';
      ticket.append(codeBox, button(label, () => actions.copy(view.invite), 'btn small'));
      people.append(ticket);
      if (copy === 'failed') people.append(el('p', 'error', '복사하지 못했습니다.'));
    }

    const seats = el('ul', 'seats');
    for (const row of view.rows) {
      const colors = COLORS[row.color] ?? COLORS[0];
      const seat = el('li', row.me ? 'seat me' : 'seat');
      seat.append(dot(colors.fill, colors.edge), el('span', 'seat-name', row.me ? `${row.name} (나)` : row.name));
      if (row.bot) seat.append(el('span', 'tag', 'AI'));
      else if (row.host) seat.append(el('span', 'tag host', '방장'));
      else seat.append(el('span', row.ready ? 'tag ready' : 'tag', row.ready ? '준비 완료' : '준비 중'));
      seats.append(seat);
    }
    people.append(seats, el('p', 'hint', `${view.rows.length}명 / 최대 ${MAX_PLAYERS}명`));
    people.append(
      labeled(
        '내 색',
        swatches(view.myColor, view.takenColors, (color) => actions.color(color)),
      ),
    );

    const rules = el('div', 'column');
    rules.append(el('h2', 'heading', view.isHost ? '경기 설정' : '방장이 정한 경기 설정'));
    const mode = MODES.find((m) => m.id === settings.mode) ?? MODES[0];
    rules.append(
      labeled(
        '모드',
        options(
          MODES.map((m) => ({ value: m.id, label: m.name })),
          settings.mode,
          canEdit,
          (value) => actions.settings({ mode: value }),
        ),
        el('p', 'summary', mode.summary),
      ),
      labeled(
        '목표 점수',
        options(
          TARGETS.map((target) => ({ value: target as number, label: `${target}점` })),
          settings.target,
          canEdit,
          (value) => actions.settings({ target: value }),
        ),
      ),
      labeled(
        '맵',
        options(
          [{ value: RANDOM_MAP, label: '무작위' }, ...MAPS.map((map, i) => ({ value: i, label: map.name }))],
          settings.mapSetting,
          canEdit,
          (value) => actions.settings({ mapSetting: value }),
        ),
      ),
    );

    const minBots = view.practice ? 1 : 0;
    const fewer = button('−', () => actions.settings({ bots: settings.bots - 1 }), 'option step');
    const more = button('+', () => actions.settings({ bots: settings.bots + 1 }), 'option step');
    fewer.setAttribute('aria-label', 'AI 줄이기');
    more.setAttribute('aria-label', 'AI 늘리기');
    fewer.disabled = !canEdit || settings.bots <= minBots;
    more.disabled = !canEdit || settings.bots >= view.maxBots;
    const stepper = el('div', 'options');
    stepper.append(fewer, el('span', 'count', `${settings.bots}명`), more);
    rules.append(labeled('AI 수', stepper));

    const foot = el('div', 'column foot');
    if (!view.settled) {
      foot.append(el('p', 'hint', '방의 상태를 확인하는 중입니다.'));
    } else if (view.isHost) {
      const start = button('시작하기', actions.start, 'btn primary');
      start.disabled = !view.canStart;
      foot.append(start);
      if (!view.canStart) {
        const alone = view.rows.length < 2;
        foot.append(
          el('p', 'hint', alone ? '두 명 이상이어야 시작할 수 있습니다.' : '모두 준비하면 시작할 수 있습니다.'),
        );
      }
    } else {
      foot.append(button(view.ready ? '준비 취소' : '준비하기', actions.ready, view.ready ? 'btn' : 'btn primary'));
      foot.append(
        el('p', 'hint', view.ready ? '방장이 시작하기를 기다립니다.' : '준비하면 방장이 경기를 시작할 수 있습니다.'),
      );
    }
    foot.append(button('나가기', actions.leave, 'btn quiet'));

    panel.append(people, rules, foot);
    return panel;
  }

  function play(view: Extract<MenuView, { kind: 'play' }>): HTMLElement {
    const corner = el('div', 'corner');
    corner.append(
      button(view.muted ? '소리 켜기' : '소리 끄기', actions.sound, 'btn small'),
      button('나가기', actions.leave, 'btn small'),
    );
    return corner;
  }

  function result(view: Extract<MenuView, { kind: 'result' }>): HTMLElement {
    const panel = el('div', 'panel');
    panel.append(el('h1', 'title', view.winner === null ? '무승부' : `${view.winner} 우승`));
    const rows = el('ul', 'seats');
    for (const row of view.rows) {
      const item = el('li', row.me ? 'seat me' : 'seat');
      item.append(
        dot(row.fill, row.edge),
        el('span', 'seat-name', row.me ? `${row.name} (나)` : row.name),
        el('span', 'points', `${row.score}점`),
      );
      rows.append(item);
    }
    panel.append(rows);
    if (view.isHost) panel.append(button('대기실로 돌아가기', actions.lobby, 'btn primary'));
    else panel.append(el('p', 'hint', '방장이 대기실로 돌아가기를 기다립니다.'));
    panel.append(button('나가기', actions.leave, 'btn quiet'));
    return panel;
  }

  function build(view: MenuView): HTMLElement {
    if (view.kind === 'title') return title(view);
    if (view.kind === 'lobby') return lobby(view);
    if (view.kind === 'play') return play(view);
    return result(view);
  }

  function show(view: MenuView): void {
    const key = JSON.stringify(view);
    if (key === lastKey) return;
    lastKey = key;
    // 같은 화면을 다시 만들 때에는 글자를 입력하던 칸과 스크롤 위치를 그대로 둡니다.
    const same = view.kind === lastKind;
    lastKind = view.kind;
    const active = document.activeElement;
    const focus = same && active instanceof HTMLInputElement ? active.dataset.focus : undefined;
    const scroll = same ? (layer.firstElementChild?.scrollTop ?? 0) : 0;
    layer.className = `menus ${view.kind}`;
    const next = build(view);
    layer.replaceChildren(next);
    next.scrollTop = scroll;
    if (focus) next.querySelector<HTMLInputElement>(`input[data-focus="${focus}"]`)?.focus();
  }

  return { show };
}

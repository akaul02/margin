// Ceal, the lab's seal, walks people through the tutorial. Plain DOM rather than React so it can
// ride inside driver.js's popover (which lives in the browser's top layer) and hop between steps.
// Every move is a transform; with reduced motion Ceal simply appears where it needs to be.

export const SEAL_SVG = `<svg class="seal-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="seal-fur" gradientUnits="userSpaceOnUse" x1="36" y1="22" x2="98" y2="92">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#eff4f9"/><stop offset="1" stop-color="#d4deea"/>
    </linearGradient>
  </defs>
  <ellipse class="seal-shadow" cx="64" cy="112.2" rx="35" ry="4.2" fill="#0e2052" opacity="0.15"/>
  <g class="seal-tail"><path d="M82 101 C 90 99.6 97 99.2 102 98.2 C 105.6 95.4 110.4 95.2 111.6 97.8 C 112.6 100.4 110 102.6 107 103.2 C 110.4 103.8 113 105.8 112 108.2 C 110.8 110.6 106 110.4 102 108.6 C 96 108.6 89 109.4 82 109.2 Z" fill="#c9d5e4"/></g>
  <g class="seal-flipper seal-flipper-r"><path d="M86.1 74.67 C90.26 77.14 94.56 79.47 97.19 82.23 C100.18 85.43 100.35 88.65 98.16 90.52 C95.85 92.52 92.02 91.38 89.32 88.69 C85.98 85.3 83.73 82.13 81.9 79.33 C81.79 77.18 83.95 74.78 86.1 74.67 Z" fill="#c9d5e4"/></g>
  <g class="seal-body">
    <path d="M58 44 C 66 42 73.5 41 76.6 41.5 C 77.4 52 84.5 58 90.5 65.5 C 96.5 73.5 98.4 86 96.6 95.5 C 95 104 88 110.8 72 110.8 L 56 110.8 C 42 110.8 33.2 106.6 30 98.4 C 27 90.6 27.4 80.6 31.2 72.6 C 34.2 66 41 58 47 54 C 50.4 49.6 53.6 45.2 58 44 Z" fill="url(#seal-fur)"/>
    <ellipse cx="54" cy="92.5" rx="19" ry="15.6" fill="#ffffff" opacity="0.85"/>
    <g class="seal-scarf">
      <path d="M28.6 57.4 C 42 66.4 66 66.6 86.4 56.6 C 88.4 57.6 89.6 61.4 89.2 64.8 C 68 76.6 42 76.6 27.8 66.2 C 26.2 63.6 26.6 59.2 28.6 57.4 Z" fill="#31c5f4"/>
      <path class="seal-scarf-tail" d="M66.2 70.6 L 74.6 69.4 C 76.6 75.6 79.6 82.6 81.6 88.6 C 79.6 91.4 75.6 92.6 72.4 91.8 C 70.8 85.2 68.6 77 66.2 70.6 Z" fill="#1aa6d8"/>
      <path d="M65.6 68.6 C 67.2 66.4 73 66 75 68.2 C 76.2 70.8 74.4 73.6 70.6 73.8 C 67.2 73.8 65 71.4 65.6 68.6 Z" fill="#31c5f4"/>
    </g>
    <g class="seal-head">
      <path d="M46.6 18.6 C 45.2 13 48.8 8.6 54.8 9.2 C 52.2 10.4 51.2 12.6 52 14.8 C 52.6 16.4 53.8 17.6 55.2 18.4 Z" fill="url(#seal-fur)"/>
      <path d="M50.5 16 C 65.5 16 76.8 26.5 76.8 41.5 C 76.8 56 66 65.6 50.5 65.6 C 35 65.6 24.2 56 24.2 41.5 C 24.2 26.5 35.5 16 50.5 16 Z" fill="url(#seal-fur)"/>
      <ellipse cx="31.4" cy="53.4" rx="4.3" ry="2.6" fill="#ff9fb3" opacity="0.55"/>
      <ellipse cx="65.6" cy="52.4" rx="4.3" ry="2.6" fill="#ff9fb3" opacity="0.55"/>
      <g class="seal-eye"><g class="seal-pupil">
        <ellipse cx="37.6" cy="43.2" rx="5.3" ry="6.1" fill="#0e2052"/>
        <ellipse cx="38.1" cy="46.9" rx="2.9" ry="1.3" fill="#31c5f4" opacity="0.35"/>
        <circle cx="35.9" cy="40.8" r="2.1" fill="#ffffff"/>
        <circle cx="39.7" cy="44.6" r="0.95" fill="#ffffff"/>
      </g></g>
      <g class="seal-eye"><g class="seal-pupil">
        <ellipse cx="58.6" cy="42.4" rx="5.3" ry="6.1" fill="#0e2052"/>
        <ellipse cx="59.1" cy="46.1" rx="2.9" ry="1.3" fill="#31c5f4" opacity="0.35"/>
        <circle cx="56.9" cy="40" r="2.1" fill="#ffffff"/>
        <circle cx="60.7" cy="43.8" r="0.95" fill="#ffffff"/>
      </g></g>
      <g fill="#d3dce8"><ellipse cx="43.1" cy="55.3" rx="5.2" ry="4.1"/><ellipse cx="50.9" cy="55.3" rx="5.2" ry="4.1"/></g>
      <g fill="#ffffff"><ellipse cx="43.1" cy="54.4" rx="5.2" ry="4.1"/><ellipse cx="50.9" cy="54.4" rx="5.2" ry="4.1"/></g>
      <path d="M44.3 49.7 Q 47 48.3 49.7 49.7 Q 49.5 52.3 47 53.1 Q 44.5 52.3 44.3 49.7 Z" fill="#0e2052"/>
      <ellipse cx="46" cy="50" rx="0.95" ry="0.5" fill="#ffffff" opacity="0.7"/>
      <path class="seal-mouth" d="M42.9 56.9 Q 45 59.3 47 57.1 Q 49 59.3 51.1 56.9" fill="none" stroke="#0e2052" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="seal-mouth-open" fill="#0e2052"><path d="M43.4 56.6 Q 47 57.6 50.6 56.6 Q 50.5 62 47 62.1 Q 43.5 62 43.4 56.6 Z"/><path d="M44.7 60.2 Q 47 58.9 49.3 60.2 Q 48.5 61.8 47 61.85 Q 45.5 61.8 44.7 60.2 Z" fill="#ff8fa8"/></g>
      <g class="seal-whiskers" fill="#0e2052" opacity="0.6">
        <circle cx="40" cy="53.9" r="0.7"/><circle cx="42.4" cy="55.6" r="0.7"/><circle cx="39.9" cy="56.9" r="0.7"/>
        <circle cx="54" cy="53.9" r="0.7"/><circle cx="51.6" cy="55.6" r="0.7"/><circle cx="54.1" cy="56.9" r="0.7"/>
        <path d="M37.4 54.6 L 31.6 53.2 M 37.6 56.8 L 31.8 57.8 M 56.6 54.6 L 62.4 53.2 M 56.4 56.8 L 62.2 57.8" fill="none" stroke="#0e2052" stroke-width="0.85" stroke-linecap="round"/>
      </g>
    </g>
  </g>
  <g class="seal-flipper seal-flipper-l"><path d="M41.86 75.65 C40.22 80.48 38.76 85.41 36.5 88.72 C33.86 92.51 30.58 93.39 28.18 91.54 C25.61 89.59 25.95 85.4 28.12 82.04 C30.88 77.86 33.66 74.84 36.14 72.35 C38.33 71.76 41.27 73.46 41.86 75.65 Z" fill="#dbe4ef"/></g>
</svg>`;

const FISH = `<svg viewBox="0 0 24 14" aria-hidden="true"><path d="M2 7 C 6 1 14 1 18 7 C 14 13 6 13 2 7 Z M 18 7 L 23 2 L 23 12 Z" fill="#1aa6d8"/><circle cx="7" cy="6" r="1.2" fill="#0e2052"/></svg>`;
const PAPERS = ['#fff2a6', '#ffd3df', '#cde7ff', '#d4f1c5', '#ffd9b3', '#e4daff', '#c6efe4', '#ffcfc7', '#e7f5b3'];
export type Mood = 'idle' | 'talk' | 'point' | 'cheer' | 'wave';
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const done = (a: Animation) => a.finished.then(() => undefined, () => undefined);
const frame = () => new Promise(r => requestAnimationFrame(() => r(undefined)));

/** Ceal's eyes follow the pointer (mirrored when Ceal faces right). */
export function lookAt(root: Element, x: number, y: number) {
  const mirrored = root.closest('[data-facing="right"]') !== null;
  for (const eye of root.querySelectorAll<SVGGElement>('.seal-pupil')) {
    const r = eye.getBoundingClientRect();
    let dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1.7, d / 30) / d;
    if (mirrored) dx = -dx;
    eye.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
  }
}

/** A stage in the top layer for exits and confetti, raised above driver.js each time it is used. */
function stage() {
  let el = document.querySelector<HTMLElement>('.seal-stage');
  if (!el) {
    el = document.createElement('div');
    el.className = 'seal-stage';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('popover', 'manual');
    document.body.append(el);
  }
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  } catch {
    /* No popover support: the stage is still a fixed layer. */
  }
  return el;
}
function clearStage(el: HTMLElement) {
  if (el.childElementCount) return;
  try {
    el.hidePopover();
  } catch {
    /* Already hidden. */
  }
  el.remove();
}

/** Mini sticky notes (and, for big moments, fish) thrown up and falling with gravity. */
export function burst(x: number, y: number, count: number, fish = false) {
  if (calm()) return;
  const layer = stage();
  const pieces: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const isFish = fish && i % 4 === 0;
    bit.className = isFish ? 'seal-bit fish' : 'seal-bit';
    if (isFish) bit.innerHTML = FISH;
    else bit.style.background = PAPERS[i % PAPERS.length];
    layer.append(bit);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
    const speed = 280 + Math.random() * (fish ? 420 : 260);
    const vx = Math.cos(angle) * speed,
      vy = Math.sin(angle) * speed,
      g = 980,
      life = 0.9 + Math.random() * 0.7,
      spin = (Math.random() - 0.5) * 1080,
      wobble = Math.random() * 6;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = (k / 12) * life;
      frames.push({
        transform: `translate(${x + vx * t + Math.sin(t * 9) * wobble}px, ${y + vy * t + 0.5 * g * t * t}px) rotate(${spin * t}deg) scale(${k === 0 ? 0.3 : 1})`,
        opacity: k > 8 ? 1 - (k - 8) / 4 : 1,
      });
    }
    pieces.push(done(bit.animate(frames, { duration: life * 1000, easing: 'linear', fill: 'forwards' })).then(() => bit.remove()));
  }
  void Promise.all(pieces).then(() => clearStage(layer));
}

type Side = 'left' | 'right' | 'below' | 'above';
export class SealGuide {
  readonly el: HTMLDivElement;
  private squash: HTMLElement;
  private last: DOMRect | null = null;
  private busy = false;
  private ticket = 0;
  private stop: () => void;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'seal seal-guide';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.mood = 'idle';
    this.el.innerHTML = `<div class="seal-turn"><div class="seal-squash">${SEAL_SVG}</div></div>`;
    this.squash = this.el.querySelector('.seal-squash')!;
    const follow = (e: PointerEvent) => lookAt(this.el, e.clientX, e.clientY);
    addEventListener('pointermove', follow, { passive: true });
    this.stop = () => removeEventListener('pointermove', follow);
  }
  mood(mood: Mood) {
    this.el.dataset.mood = mood;
  }
  /** Sit beside the popover, facing and pointing at the step's target, hopping over from the last spot. */
  async join(popover: HTMLElement, target?: Element) {
    // A newer step's join supersedes this one; the watchdog leaves Ceal alone meanwhile.
    const ticket = ++this.ticket;
    this.busy = true;
    try {
      await this.travel(ticket, popover, target);
    } finally {
      if (ticket === this.ticket) this.busy = false;
    }
  }
  /** When a step change begins, wait where Ceal is (above driver.js) instead of vanishing with the old bubble. */
  hold() {
    if (calm() || !this.last || !this.el.isConnected || this.el.parentElement?.classList.contains('seal-stage')) return;
    stage().append(this.el);
    this.el.style.left = `${this.last.left}px`;
    this.el.style.top = `${this.last.top}px`;
  }
  private async travel(ticket: number, popover: HTMLElement, target?: Element) {
    this.hold();
    if (!this.last) popover.append(this.el);
    // driver.js parks the bubble at 0,0 while it moves the spotlight; wait until it is placed and still.
    let p = popover.getBoundingClientRect();
    for (let i = 0; i < 60; i++) {
      await frame();
      const q = popover.getBoundingClientRect();
      const still = Math.abs(q.left - p.left) < 0.5 && Math.abs(q.top - p.top) < 0.5;
      p = q;
      if (q.width > 0 && (q.left > 0 || q.top > 0) && still) break;
    }
    if (ticket !== this.ticket || !popover.isConnected) return;
    const waiting = this.el.parentElement?.classList.contains('seal-stage') ? this.el.parentElement : null;
    popover.append(this.el);
    if (waiting) clearStage(waiting);
    const now = this.place(popover, target);
    const from = this.last;
    this.last = now;
    if (calm()) return;
    if (!from) await this.arrive(now);
    else if (Math.hypot(from.left - now.left, from.top - now.top) > 6) await this.hop(from, now);
  }
  /** Beside the bubble, away from what it points at, and always inside the window. */
  private place(popover: HTMLElement, target?: Element) {
    const size = this.el.offsetWidth || 108;
    const p = popover.getBoundingClientRect();
    const t = target?.getBoundingClientRect();
    const offsets: Record<Side, [number, number]> = {
      left: [-size + 18, p.height - size + 10],
      right: [p.width - 18, p.height - size + 10],
      below: [14, p.height - 8],
      above: [14, -size + 8],
    };
    const inView = (x: number, y: number) => x > 6 && y > 6 && x + size < innerWidth - 6 && y + size < innerHeight - 6;
    const clear = (x: number, y: number) => !t || x > t.right + 8 || x + size < t.left - 8 || y > t.bottom + 8 || y + size < t.top - 8;
    const away: Side[] = t && t.left + t.width / 2 < p.left ? ['right', 'below', 'above', 'left'] : ['left', 'right', 'below', 'above'];
    const at = (s: Side) => [p.left + offsets[s][0], p.top + offsets[s][1]] as const;
    const side = away.find(s => inView(...at(s)) && clear(...at(s))) ?? away.find(s => inView(...at(s))) ?? away[0];
    const [x, y] = at(side);
    const cx = Math.min(Math.max(x, 6), innerWidth - size - 6),
      cy = Math.min(Math.max(y, 6), innerHeight - size - 6);
    this.el.style.left = `${cx - p.left}px`;
    this.el.style.top = `${cy - p.top}px`;
    const now = this.el.getBoundingClientRect();
    if (t) this.aim(now, t);
    return now;
  }
  /** A safety net while the tour runs: re-join a replaced bubble, and come back if pushed off screen. */
  keepUp(popover: HTMLElement | null, target?: Element) {
    if (!popover || this.busy || !popover.getBoundingClientRect().width) return;
    if (!popover.contains(this.el)) return void this.join(popover, target);
    const r = this.el.getBoundingClientRect();
    if (r.width && r.left > 2 && r.top > 2 && r.right < innerWidth - 2 && r.bottom < innerHeight - 2) return;
    this.last = this.place(popover, target);
  }
  private aim(me: DOMRect, t: DOMRect) {
    const tx = t.left + t.width / 2,
      ty = t.top + t.height / 2;
    const right = tx > me.left + me.width / 2;
    this.el.dataset.facing = right ? 'right' : 'left';
    // The front flipper's shoulder, and the angle it rests at (down and to the left).
    const sx = me.left + (right ? 1 - 39 / 120 : 39 / 120) * me.width,
      sy = me.top + (74 / 120) * me.height;
    let angle = (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI;
    if (right) angle = 180 - angle;
    const turn = ((angle - 120 + 540) % 360) - 180;
    this.el.style.setProperty('--point', `${Math.max(-40, Math.min(170, turn)).toFixed(1)}deg`);
  }
  /** First appearance: a belly slide in from the right edge, a pop up, and a wave. */
  private async arrive(now: DOMRect) {
    const dx = innerWidth + 40 - now.left;
    const slide = this.el.animate(
      [
        { transform: `translate(${dx}px, 8px)` },
        { transform: 'translate(-10px, 8px)', offset: 0.72 },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 1000, easing: 'cubic-bezier(.15,.75,.3,1)' },
    );
    this.squash.animate(
      [
        { transform: 'rotate(-78deg) scale(1.05, 0.92)' },
        { transform: 'rotate(-74deg) scale(1.08, 0.9)', offset: 0.62 },
        { transform: 'rotate(12deg) scale(0.88, 1.16)', offset: 0.8 },
        { transform: 'rotate(-4deg) scale(1.1, 0.9)', offset: 0.9 },
        { transform: 'rotate(0) scale(1, 1)' },
      ],
      { duration: 1000, easing: 'ease-out' },
    );
    await sleep(700);
    this.spray(now);
    await done(slide);
    this.mood('wave');
    await sleep(900);
    if (this.el.dataset.mood === 'wave') this.mood('point');
  }
  /** Hop along an arc from the last spot, with anticipation, stretch and a squashy landing. */
  private async hop(from: DOMRect, to: DOMRect) {
    const dx = from.left - to.left,
      dy = from.top - to.top,
      dist = Math.hypot(dx, dy),
      // High enough to read as a hop, never so high the arc leaves the window.
      lift = Math.max(24, Math.min(170, 46 + dist * 0.28, Math.min(from.top, to.top) - 8)),
      spin = dx > 0 ? -1 : 1,
      duration = 560 + Math.min(420, dist * 0.55);
    const path: Keyframe[] = [{ transform: `translate(${dx}px, ${dy}px)`, offset: 0 }];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      path.push({
        transform: `translate(${dx * (1 - t)}px, ${dy * (1 - t) - lift * 4 * t * (1 - t)}px) rotate(${spin * Math.sin(t * Math.PI) * 16}deg)`,
        offset: 0.18 + t * 0.64,
      });
    }
    path.push({ transform: 'translate(0, 0)', offset: 1 });
    this.squash.animate(
      [
        { transform: 'scale(1, 1)', offset: 0 },
        { transform: 'scale(1.2, 0.76)', offset: 0.16 },
        { transform: 'scale(0.84, 1.22)', offset: 0.26 },
        { transform: 'scale(1, 1)', offset: 0.5 },
        { transform: 'scale(0.92, 1.1)', offset: 0.78 },
        { transform: 'scale(1.24, 0.74)', offset: 0.86 },
        { transform: 'scale(0.96, 1.06)', offset: 0.94 },
        { transform: 'scale(1, 1)', offset: 1 },
      ],
      { duration, easing: 'linear' },
    );
    await done(this.el.animate(path, { duration, easing: 'linear' }));
    this.dust(to);
  }
  /** Claps and throws stickies; the finale adds a backflip and fish. */
  async cheer(big = false) {
    if (calm() || !this.el.isConnected) return;
    const previous = this.el.dataset.mood as Mood;
    this.mood('cheer');
    const r = this.el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height * 0.35, big ? 46 : 14, big);
    const height = big ? 130 : 38,
      flip = big ? (this.el.dataset.facing === 'right' ? 360 : -360) : 0,
      duration = big ? 1250 : 620;
    this.squash.animate(
      [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.18, 0.8)', offset: 0.14 },
        { transform: 'scale(0.86, 1.18)', offset: 0.3 },
        { transform: 'scale(1, 1)', offset: 0.6 },
        { transform: 'scale(1.2, 0.8)', offset: 0.86 },
        { transform: 'scale(1, 1)' },
      ],
      { duration },
    );
    await done(
      this.el.animate(
        [
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: 'translate(0, 6px) rotate(0deg)', offset: 0.14 },
          { transform: `translate(0, ${-height}px) rotate(${flip / 2}deg)`, offset: 0.5 },
          { transform: `translate(0, 0) rotate(${flip}deg)`, offset: 0.84 },
          { transform: `translate(0, 0) rotate(${flip}deg)` },
        ],
        { duration, easing: 'cubic-bezier(.3,.7,.4,1)' },
      ),
    );
    if (this.el.dataset.mood === 'cheer') this.mood(previous === 'cheer' ? 'point' : previous);
  }
  /** Leaves the closing tour: waves and slides off when skipped, dives off with a splash when finished. */
  async leave(finished: boolean) {
    this.stop();
    this.ticket++;
    const r = this.last && this.el.isConnected ? this.el.getBoundingClientRect() : this.last;
    // Stop any slide or hop in progress so the goodbye starts from where Ceal is on screen.
    for (const a of [...this.el.getAnimations(), ...this.squash.getAnimations()]) if (!(a instanceof CSSAnimation)) a.cancel();
    if (!r || calm()) return this.el.remove();
    const layer = stage();
    layer.append(this.el);
    Object.assign(this.el.style, { left: `${r.left}px`, top: `${r.top}px` });
    if (finished) {
      this.mood('cheer');
      const fall = innerHeight - r.top + 40;
      this.squash.animate([{ transform: 'scale(1.2, 0.8)' }, { transform: 'scale(0.85, 1.2)', offset: 0.25 }, { transform: 'scale(1, 1)' }], { duration: 900 });
      await done(
        this.el.animate(
          [
            { transform: 'translate(0, 0) rotate(0deg)' },
            { transform: 'translate(0, -110px) rotate(-90deg)', offset: 0.35 },
            { transform: `translate(30px, ${fall}px) rotate(-190deg)` },
          ],
          { duration: 950, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' },
        ),
      );
      this.splash(r.left + r.width / 2);
    } else {
      this.mood('wave');
      await sleep(650);
      await done(
        this.el.animate([{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(0, ${innerHeight - r.top + 40}px)`, opacity: 1 }], {
          duration: 650,
          easing: 'cubic-bezier(.5,0,.9,.5)',
          fill: 'forwards',
        }),
      );
    }
    this.el.remove();
    clearStage(layer);
  }
  /** Spray of ice where the belly slide stops. */
  private spray(at: DOMRect) {
    const layer = stage();
    for (let i = 0; i < 10; i++) {
      const drop = document.createElement('i');
      drop.className = 'seal-drop';
      layer.append(drop);
      const x = at.left + at.width * 0.25,
        y = at.bottom - 8,
        vx = 60 + Math.random() * 140,
        vy = -(80 + Math.random() * 160);
      void done(
        drop.animate(
          [
            { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 0.9 },
            { transform: `translate(${x + vx * 0.5}px, ${y + vy * 0.5 + 60}px) scale(0.4)`, opacity: 0 },
          ],
          { duration: 550 + Math.random() * 250, easing: 'ease-out', fill: 'forwards' },
        ),
      ).then(() => {
        drop.remove();
        clearStage(layer);
      });
    }
  }
  /** A puff of dust on landing. */
  private dust(at: DOMRect) {
    const layer = stage();
    for (const side of [-1, 1]) {
      const puff = document.createElement('i');
      puff.className = 'seal-puff';
      layer.append(puff);
      const x = at.left + at.width / 2 + side * 18,
        y = at.bottom - 10;
      void done(
        puff.animate(
          [
            { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 0.7 },
            { transform: `translate(${x + side * 30}px, ${y - 6}px) scale(1.3)`, opacity: 0 },
          ],
          { duration: 420, easing: 'ease-out', fill: 'forwards' },
        ),
      ).then(() => {
        puff.remove();
        clearStage(layer);
      });
    }
  }
  /** Rings and droplets where Ceal dives out of view. */
  private splash(x: number) {
    const layer = stage();
    for (let i = 0; i < 14; i++) {
      const drop = document.createElement('i');
      drop.className = 'seal-drop';
      layer.append(drop);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6,
        speed = 240 + Math.random() * 260,
        y = innerHeight - 6;
      void done(
        drop.animate(
          [
            { transform: `translate(${x}px, ${y}px)`, opacity: 1 },
            { transform: `translate(${x + Math.cos(angle) * speed * 0.6}px, ${y + Math.sin(angle) * speed * 0.6 + 120}px)`, opacity: 0 },
          ],
          { duration: 700, easing: 'cubic-bezier(.2,.7,.6,1)', fill: 'forwards' },
        ),
      ).then(() => {
        drop.remove();
        clearStage(layer);
      });
    }
  }
}

/** Types the step text into place while Ceal talks; screen readers get the whole sentence at once. */
export function typeOut(el: HTMLElement, guide: SealGuide) {
  const text = el.textContent ?? '';
  if (calm() || !text) {
    guide.mood('point');
    return () => undefined;
  }
  const typed = document.createElement('span'),
    rest = document.createElement('span'),
    whole = document.createElement('span');
  typed.setAttribute('aria-hidden', 'true');
  rest.setAttribute('aria-hidden', 'true');
  rest.className = 'seal-untyped';
  whole.className = 'sr-only';
  whole.textContent = text;
  rest.textContent = text;
  el.replaceChildren(typed, rest, whole);
  guide.mood('talk');
  let i = 0;
  const timer = setInterval(
    () => {
      i = Math.min(text.length, i + (text[i] === ' ' ? 2 : 1));
      typed.textContent = text.slice(0, i);
      rest.textContent = text.slice(i);
      if (i >= text.length) {
        clearInterval(timer);
        guide.mood('point');
      }
    },
    Math.max(14, Math.min(32, 1100 / text.length)),
  );
  return () => clearInterval(timer);
}

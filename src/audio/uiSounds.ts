/**
 * Sounds for every button, link, tab and card on every screen, from one set
 * of document listeners: no component has to wire its own.
 *
 * - Pointer over something pressable: a dry tick.
 * - Arrow keys or Tab moving focus: a blip.
 * - A press: a click, or the coin-in chirp for a primary action or a song card.
 * - Esc, or a button that goes back: the chirp, downward.
 * - M: sound effects on or off (remembered).
 *
 * An element can choose its own press sound with data-sfx="confirm" (any
 * SfxName), or none with data-sfx="none".
 */
import { toast } from 'sonner';
import { isSfxMuted, playSfx, setSfxMuted, unlockSfx, type SfxName } from './sfx';

const PRESSABLE =
  'button:not(:disabled), a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], summary, input[type="checkbox"], input[type="radio"]';
/** A key press and the click it causes are one sound. */
const KEY_CLICK_GAP_MS = 200;
/** Keys that move focus between items. */
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'PageUp', 'PageDown']);
/** Focus moving this soon after one of those keys was the key's doing. */
const KEY_FOCUS_GAP_MS = 400;
const BACK_LABEL = /^(back|close|cancel|songs|change song)\b/i;

let installed = false;

function pressable(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(PRESSABLE) : null;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type);
}

/** The sound a press on `element` makes, or null for none. */
export function pressSound(element: HTMLElement): SfxName | null {
  const own = element.closest<HTMLElement>('[data-sfx]')?.dataset.sfx;
  if (own === 'none') return null;
  if (own) return own as SfxName;
  if (element.getAttribute('role') === 'tab') return 'toggle';
  if (element.classList.contains('menu-card')) return 'confirm';
  if (element.matches('.button--primary, [type="submit"]')) return 'confirm';
  const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
  if (BACK_LABEL.test(label)) return 'back';
  return 'press';
}

export function installUiSounds(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  let lastKeyAt = -Infinity;
  let keyPressed: { element: HTMLElement; at: number } | null = null;
  let hovered: HTMLElement | null = null;
  let touchPress: { element: HTMLElement; selected: boolean } | null = null;

  const options = { capture: true, passive: true } as const;

  document.addEventListener(
    'pointerdown',
    (event) => {
      unlockSfx();
      const element = pressable(event.target);
      // On touch, the first tap on a song card only selects it.
      touchPress =
        element && event.pointerType !== 'mouse'
          ? { element, selected: element.dataset.selected !== 'false' }
          : null;
    },
    options,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      unlockSfx();
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (NAV_KEYS.has(event.key)) lastKeyAt = performance.now();
      if (typing(event.target)) return;

      if (event.key === 'm' || event.key === 'M') {
        const next = !isSfxMuted();
        setSfxMuted(next);
        if (!next) playSfx('toggle');
        toast(next ? 'Sound effects off' : 'Sound effects on', { description: 'Press M to switch them back.' });
        return;
      }
      if (event.key === 'Escape') {
        playSfx('back');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const element = pressable(event.target);
        const sound = element && pressSound(element);
        if (!element || !sound) return;
        // Some views handle Enter themselves and stop the click, so the sound goes here, once.
        keyPressed = { element, at: performance.now() };
        playSfx(sound);
      }
    },
    options,
  );

  document.addEventListener(
    'click',
    (event) => {
      const element = pressable(event.target);
      if (!element) return;
      if (keyPressed && keyPressed.element === element && performance.now() - keyPressed.at < KEY_CLICK_GAP_MS) {
        keyPressed = null;
        return;
      }
      if (touchPress?.element === element && element.classList.contains('menu-card') && !touchPress.selected) {
        playSfx('nav');
        return;
      }
      const sound = pressSound(element);
      if (sound) playSfx(sound);
    },
    options,
  );

  document.addEventListener(
    'pointerover',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      const element = pressable(event.target);
      if (element === hovered) return;
      hovered = element;
      if (element) playSfx('hover');
    },
    options,
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (performance.now() - lastKeyAt > KEY_FOCUS_GAP_MS) return;
      if (pressable(event.target) || (event.target instanceof HTMLElement && event.target.tabIndex >= 0)) {
        playSfx('nav');
      }
    },
    options,
  );
}

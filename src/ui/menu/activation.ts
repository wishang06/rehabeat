/*
 * Browsers block sound until the page has had a click, tap or key press
 * ("user activation"). Previews wait for it rather than fail.
 */

/** The parts of an input event that say whether it activates the page. */
export interface InputLike {
  type: string;
  key?: string;
  pointerType?: string;
}

/** The input events to listen for. */
export const ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;

/**
 * Whether `event` gives the page user activation, following the HTML spec's
 * list: a key press other than Esc, a mouse button press, or the end of a
 * touch or pen tap.
 */
export function isActivationEvent(event: InputLike): boolean {
  switch (event.type) {
    case 'keydown':
      return event.key !== 'Escape';
    case 'pointerdown':
      return event.pointerType === 'mouse';
    case 'pointerup':
      return event.pointerType !== undefined && event.pointerType !== 'mouse';
    case 'touchend':
      return true;
    default:
      return false;
  }
}

interface UserActivationLike {
  hasBeenActive: boolean;
}

/**
 * Whether the page has had user activation. Uses navigator.userActivation
 * where the browser has it; otherwise `seen` (an activating event was seen).
 */
export function pageHasBeenActive(
  seen: boolean,
  activation: UserActivationLike | undefined = (globalThis.navigator as { userActivation?: UserActivationLike } | undefined)
    ?.userActivation,
): boolean {
  return activation ? activation.hasBeenActive : seen;
}

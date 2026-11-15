// Does the screen fit the window? Used by the smoke check and the screenshot
// walk to hold the /play screens to "no scrolling on a desktop": at 1024 px
// wide and up, nothing scrolls and nothing spills out of its screen.

/** The smallest desktop width the no-scroll rule covers. */
export const DESKTOP_MIN_WIDTH = 1024;

/**
 * Describes everything on the page that breaks the rule, or an empty list:
 * the page scrolling either way, any element that scrolls its content, and
 * any visible text or control that pokes out of the window, its screen
 * (.screen) or the marquee (.app__bar). Decorations (aria-hidden) and the
 * camera picture, which is meant to be cropped, are left out.
 */
export function scrollProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const TOLERANCE = 1.5;
    const name = (element) => {
      const id = element.getAttribute('data-testid');
      if (id) return `[data-testid=${id}]`;
      const classes = [...element.classList].slice(0, 2).join('.');
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };

    const root = document.documentElement;
    if (root.scrollHeight > window.innerHeight + TOLERANCE) problems.push(`the page scrolls down (${root.scrollHeight} px in ${window.innerHeight})`);
    if (root.scrollWidth > window.innerWidth + TOLERANCE) problems.push(`the page scrolls across (${root.scrollWidth} px in ${window.innerWidth})`);

    for (const element of document.body.querySelectorAll('*')) {
      if (element.closest('dialog:not([open])')) continue;
      const style = getComputedStyle(element);
      const down = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + TOLERANCE;
      const across = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + TOLERANCE;
      if (down) problems.push(`${name(element)} scrolls down (${element.scrollHeight} px in ${element.clientHeight})`);
      if (across) problems.push(`${name(element)} scrolls across (${element.scrollWidth} px in ${element.clientWidth})`);
    }

    const content = document.body.querySelectorAll('h1, h2, h3, p, li, dt, dd, button, a, input, label, kbd, .led, .avatar');
    for (const element of content) {
      if (element.closest('[aria-hidden="true"], .stage__frame, dialog:not([open])')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const container = element.closest('.screen, .app__bar, .profile__panel, dialog[open]');
      const bounds = container?.matches('.profile__panel, dialog[open]')
        ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
        : (container?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
      const right = Math.min(bounds.right, window.innerWidth);
      const bottom = Math.min(bounds.bottom, window.innerHeight);
      if (box.bottom > bottom + TOLERANCE || box.right > right + TOLERANCE || box.top < bounds.top - TOLERANCE || box.left < bounds.left - TOLERANCE) {
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        problems.push(`${name(element)} "${text}" spills out (${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)})`);
      }
    }
    return [...new Set(problems)].slice(0, 12);
  });
}

import { expect, test } from 'vite-plus/test';
import { follows } from './scroll';
// A chat's scroll box the way useStickToBottom drives it: new text makes the page taller and, while following,
// jumps to the bottom (remembering where it landed). The reader's scrolls come in as scroll events.
function scrollBox(height = 120_000, view = 560) {
  const box = { height, top: height - view, lastTop: height - view, stick: true };
  const fromBottom = () => box.height - box.top - view;
  // A scroll event at the box's current position.
  const scrolled = () => {
    box.stick = follows(box.stick, box.top, box.lastTop, fromBottom());
    box.lastTop = box.top;
  };
  return {
    box,
    fromBottom,
    // The reply grew by `px`. Like the effect in useStickToBottom, a jump happens only while following.
    grow(px: number) {
      box.height += px;
      if (!box.stick) return;
      box.top = box.height - view;
      box.lastTop = box.top;
    },
    // The browser reports the jump a moment later, sometimes after the reader already moved.
    jumpEventArrives: scrolled,
    scroll(dy: number) {
      box.top = Math.max(0, Math.min(box.top + dy, box.height - view));
      scrolled();
    },
    // The page got shorter (a card closed) and the browser pulled the view up with it.
    shrink(px: number) {
      box.height -= px;
      box.top = Math.min(box.top, box.height - view);
      scrolled();
    },
  };
}

test('a chat follows the reply while the reader stays at the bottom', () => {
  const page = scrollBox();
  for (let i = 0; i < 50; i++) {
    page.grow(24);
    page.jumpEventArrives();
  }
  expect(page.box.stick).toBe(true);
  expect(page.fromBottom()).toBe(0);
});

test('any scroll up stops following, even a few pixels from a trackpad, and new text then leaves the view alone', () => {
  for (const steps of [[-8], [-8, -8, -8], [-40], [-100, -100, -100]]) {
    const page = scrollBox();
    for (const dy of steps) page.scroll(dy);
    const top = page.box.top;
    for (let i = 0; i < 50; i++) page.grow(24);
    expect(page.box.stick, String(steps)).toBe(false);
    expect(page.box.top, String(steps)).toBe(top);
  }
});

test("the scroll event of our own jump does not undo the reader's scroll up", () => {
  const page = scrollBox();
  page.grow(24);
  // The reader turns the wheel up before the jump's scroll event comes in. The wheel stops following right
  // away (onWheel in useStickToBottom), and the late event must not start it again.
  page.box.stick = false;
  page.jumpEventArrives();
  page.scroll(-40);
  page.grow(500);
  expect(page.box.stick).toBe(false);
});

test('coming back down near the bottom follows again, though the bottom keeps moving away', () => {
  const page = scrollBox();
  page.scroll(-2000);
  page.grow(300);
  // Each notch down lands short of a bottom that grew in the meantime.
  for (let i = 0; i < 6; i++) {
    page.scroll(400);
    page.grow(30);
  }
  expect(page.box.stick).toBe(true);
  expect(page.fromBottom()).toBe(0);
});

test('scrolling down far from the bottom does not follow yet', () => {
  const page = scrollBox();
  page.scroll(-3000);
  page.scroll(1000);
  expect(page.box.stick).toBe(false);
});

test('the page getting shorter at the bottom does not count as the reader scrolling up', () => {
  const page = scrollBox();
  page.shrink(200);
  expect(page.box.stick).toBe(true);
  page.grow(100);
  expect(page.fromBottom()).toBe(0);
});

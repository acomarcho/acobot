// Whether a chat keeps following the reply as it streams in, after the reader's view moved from `lastTop` to
// `top`. Any move up stops it, however small (a trackpad moves a few pixels at a time). The bottom keeps moving
// while the reply streams, so coming down near it is enough to start again. Moving up at the very bottom is the
// page getting shorter, not the reader.
export function follows(was: boolean, top: number, lastTop: number, fromBottom: number) {
  if (top > lastTop && fromBottom < 120) return true;
  if (top < lastTop && fromBottom >= 2) return false;
  return was;
}

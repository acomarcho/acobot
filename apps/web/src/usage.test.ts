import { expect, test } from 'vite-plus/test';
import { tokens } from './usage';

test('token counts are short, the way the context bar shows them', () => {
  expect(tokens(0)).toBe('0');
  expect(tokens(14878)).toBe('15K');
  expect(tokens(200_000)).toBe('200K');
  expect(tokens(1_048_576)).toBe('1M');
});

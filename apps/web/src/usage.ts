// A token count the way the context bar shows it: 14878 is "15K", 1048576 is "1M".
const short = new Intl.NumberFormat('en', { notation: 'compact' });
export const tokens = (count: number) => short.format(count);

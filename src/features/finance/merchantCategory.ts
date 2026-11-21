/**
 * Picks an expense category from a store name, for purchases logged
 * automatically from Apple Pay.
 *
 * 1. Learned: if you've saved an expense at the same store before, its
 *    category wins — so recategorising one purchase teaches the app.
 * 2. Known stores and keywords (Australian chains first).
 * 3. Otherwise "Other".
 */

/** "WOOLWORTHS 1234 CLAYTON PTY LTD" → "woolworths clayton" */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\b(pty|ltd|limited|inc|co|au|aus|australia|store|stores|shop)\b/g, ' ')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Category name → store names / keywords (matched as whole words, in this order). */
const RULES: [string, string[]][] = [
  ['Eating Out', ['uber eats', 'ubereats', 'doordash', 'menulog', 'mcdonalds', 'maccas', 'kfc', 'hungry jacks', 'subway', 'dominos', 'pizza hut', 'pizza', 'nandos', 'guzman', 'gyg', 'grilld', 'oporto', 'red rooster', 'zambrero', 'starbucks', 'gloria jeans', 'boost juice', 'chatime', 'gong cha', 'sushi', 'ramen', 'kebab', 'burger', 'cafe', 'coffee', 'espresso', 'bakery', 'restaurant', 'bistro', 'thai', 'dumpling', 'noodle', 'grill', 'bar', 'pub', 'hotel']],
  ['Groceries', ['woolworths', 'woolies', 'coles', 'aldi', 'iga', 'foodworks', 'harris farm', 'costco', 'drakes', 'foodland', 'spudshed', 'asian grocery', 'supermarket', 'grocer', 'fruit', 'butcher', 'market']],
  ['Transport', ['uber', 'didi', 'ola', 'myki', 'opal', 'go card', 'translink', 'ptv', 'metro trains', 'shell', 'bp', 'ampol', 'caltex', 'united petroleum', '7 eleven', 'eg fuel', 'petrol', 'fuel', 'parking', 'wilson parking', 'secure parking', 'linkt', 'citylink', 'eastlink', 'toll', 'taxi', '13cabs', 'lime', 'neuron']],
  ['Internet', ['telstra', 'optus', 'vodafone', 'tpg', 'aussie broadband', 'belong', 'amaysim', 'boost mobile', 'lebara', 'felix mobile', 'superloop', 'iinet', 'dodo']],
  ['Electricity', ['agl', 'origin energy', 'energyaustralia', 'red energy', 'alinta', 'simply energy', 'powershop', 'momentum energy', 'lumo']],
  ['Entertainment', ['netflix', 'spotify', 'disney', 'stan', 'binge', 'kayo', 'youtube', 'apple tv', 'hoyts', 'village cinemas', 'event cinemas', 'reading cinemas', 'cinema', 'steam', 'playstation', 'xbox', 'nintendo', 'ticketek', 'ticketmaster', 'timezone', 'bowling']],
  ['Education', ['university', 'uni', 'tafe', 'monash', 'deakin', 'rmit', 'swinburne', 'la trobe', 'unimelb', 'coursera', 'udemy', 'textbook', 'co op bookshop']],
  ['Shopping', ['kmart', 'target', 'big w', 'jb hi fi', 'jb hifi', 'officeworks', 'bunnings', 'amazon', 'ebay', 'myer', 'david jones', 'uniqlo', 'h&m', 'zara', 'cotton on', 'rebel', 'chemist warehouse', 'priceline', 'apple', 'ikea', 'the reject shop', 'daiso', 'temu', 'shein']],
  ['Rent', ['rent', 'real estate', 'realestate', 'property management']],
];

export interface CategoryRef {
  id: number;
  name: string;
}

export interface PastExpense {
  description: string;
  categoryId: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rule-based guess, by category name (null = no match). */
export function guessCategoryName(merchant: string): string | null {
  const m = ` ${normalizeMerchant(merchant)} `;
  for (const [category, words] of RULES) {
    if (words.some((w) => new RegExp(`\\s${escapeRe(w)}\\s`).test(m))) return category;
  }
  return null;
}

/**
 * @param history Recent expenses, newest first.
 */
export function categorizeMerchant(merchant: string, categories: CategoryRef[], history: PastExpense[]): number | null {
  const key = normalizeMerchant(merchant);
  if (key) {
    const past = history.find((h) => normalizeMerchant(h.description) === key && categories.some((c) => c.id === h.categoryId));
    if (past) return past.categoryId;
  }
  const byName = (name: string) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const guess = guessCategoryName(merchant);
  return (guess ? byName(guess) : null) ?? byName('Other') ?? categories[0]?.id ?? null;
}

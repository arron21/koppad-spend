import crypto from 'node:crypto';

export type PikminCategory = 'dining' | 'shopping' | 'groceries' | 'bills' | 'leisure';
export type ExcludeReason = 'transfer' | 'income' | 'card_payment' | 'refund' | 'manual' | null;

export interface ClassificationResult {
  merchant: string;
  category: PikminCategory;
  fruitAlias: string;
  isExcluded: boolean;
  excludeReason: ExcludeReason;
}

const CARD_PAYMENT_PATTERNS = [
  /payment\s*thank\s*you/i,
  /autopay/i,
  /credit\s*card\s*pmt/i,
  /card\s*payment/i,
  /amex\s*epayment/i,
  /chase\s*card\s*serv/i,
  /citi\s*card\s*online/i,
  /capital\s*one\s*mobile\s*pmt/i,
  /applecard\s*gsbank\s*payment/i,
];

const TRANSFER_PATTERNS = [
  /\btransfer\b/i,
  /\bxfer\b/i,
  /\bzelle\b/i,
  /venmo\s*cashout/i,
  /ach\s*withdrawal/i,
  /savings\s*auto/i,
  /brokerage\s*sweep/i,
];

const INCOME_PATTERNS = [
  /\bpayroll\b/i,
  /direct\s*dep/i,
  /\bsalary\b/i,
  /interest\s*earned/i,
  /dividend/i,
  /cashback\s*redemption/i,
  /tax\s*refund/i,
];

const CATEGORY_RULES: Array<{ category: PikminCategory; patterns: RegExp[] }> = [
  {
    category: 'groceries',
    patterns: [
      /trader\s*joe/i,
      /whole\s*foods/i,
      /safeway/i,
      /kroger/i,
      /ralphs/i,
      /publix/i,
      /wegmans/i,
      /aldi/i,
      /costco/i,
      /sprouts/i,
      /h\s*mart/i,
      /mitsuwa/i,
      /grocery/i,
      /market/i,
      /supermarket/i,
      /cvs/i,
      /walgreens/i,
      /pharmacy/i,
      /instacart/i,
    ],
  },
  {
    category: 'dining',
    patterns: [
      /starbucks/i,
      /blue\s*bottle/i,
      /peet'?s/i,
      /coffee/i,
      /cafe/i,
      /bakery/i,
      /boba/i,
      /tea\s*house/i,
      /ramen/i,
      /sushi/i,
      /pizza/i,
      /burger/i,
      /taco/i,
      /chipotle/i,
      /sweetgreen/i,
      /cava/i,
      /panera/i,
      /doordash/i,
      /uber\s*eats/i,
      /grubhub/i,
      /restaurant/i,
      /kitchen/i,
      /bistro/i,
      /grill/i,
      /diner/i,
      /noodle/i,
      /bar\b/i,
      /pub\b/i,
      /brewery/i,
      /gelato/i,
      /ice\s*cream/i,
    ],
  },
  {
    category: 'bills',
    patterns: [
      /shell\b/i,
      /chevron/i,
      /exxon/i,
      /mobil/i,
      /arco/i,
      /gas\b/i,
      /fuel/i,
      /uber\b/i,
      /lyft/i,
      /metro/i,
      /bart\b/i,
      /mta\b/i,
      /transit/i,
      /parking/i,
      /toll/i,
      /comcast/i,
      /xfinity/i,
      /verizon/i,
      /t-mobile/i,
      /at&t/i,
      /pg&e/i,
      /coned/i,
      /electric/i,
      /water\s*bill/i,
      /internet/i,
      /insurance/i,
      /geico/i,
      /rent\b/i,
      /icloud/i,
      /google\s*one/i,
      /aws/i,
    ],
  },
  {
    category: 'leisure',
    patterns: [
      /nintendo/i,
      /steam/i,
      /playstation/i,
      /xbox/i,
      /spotify/i,
      /netflix/i,
      /hulu/i,
      /disney\+/i,
      /max\.com/i,
      /youtube/i,
      /amc\s*theat/i,
      /regal/i,
      /cinema/i,
      /movie/i,
      /ticketmaster/i,
      /concert/i,
      /museum/i,
      /botanical/i,
      /airline/i,
      /delta/i,
      /united/i,
      /southwest/i,
      /airbnb/i,
      /hotel/i,
      /gym/i,
      /climbing/i,
      /bowling/i,
      /arcade/i,
      /barnes\s*&\s*noble/i,
      /bookshop/i,
      /books/i,
    ],
  },
  {
    category: 'shopping',
    patterns: [
      /amazon/i,
      /target/i,
      /walmart/i,
      /apple\.com/i,
      /apple\s*store/i,
      /best\s*buy/i,
      /ikea/i,
      /uniqlo/i,
      /nike/i,
      /rei\b/i,
      /nordstrom/i,
      /sephora/i,
      /etsy/i,
      /home\s*depot/i,
      /lowe'?s/i,
      /muji/i,
      /daiso/i,
      /clothing/i,
      /apparel/i,
      /hardware/i,
    ],
  },
];

const FRUIT_ALIASES: Record<PikminCategory, string[]> = {
  dining: [
    'Sunseed Roast',
    'Crimson Broth Pod',
    'Spiced Nectar Cup',
    'Searing Crumb Berry',
    'Velvet Mocha Drop',
    'Golden Glaze Bite',
  ],
  shopping: [
    'Sparkling Relic',
    'Zest Parcel',
    'Amber Gadget Seed',
    'Luminous Crate',
    'Citrus Treasure',
    'Starlight Curio',
  ],
  groceries: [
    'Dewdrop Harvest',
    'Velvety Melon Haul',
    'Crisp Orchard Basket',
    'Azure Ration Pack',
    'Fresh Pantry Pod',
    'Juicy Produce Bundle',
  ],
  bills: [
    'Rocket Fuel Cell',
    'Iron Transit Pass',
    'Drake Power Core',
    'Mineral Utility Orb',
    'Orbital Relay Fee',
    'Engine Coolant Refill',
  ],
  leisure: [
    'Blossom Ticket',
    'Winged Melodica',
    'Aether Arcade Token',
    'Cloudberry Story',
    'Starfield Pass',
    'Fluttering Keepsake',
  ],
};

export function cleanMerchantName(raw: string): string {
  let cleaned = raw
    .replace(/\s+#\d+/g, '')
    .replace(/\*\w+/g, '')
    .replace(/\b(POS|DEBIT|PURCHASE|ACH|TST\*|SQ \*|SP \*|CHECKCARD \d+)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned) cleaned = raw.trim() || 'Unknown Merchant';

  // Convert ALL CAPS bank strings into readable Title Case
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return cleaned.slice(0, 64);
}

export function pickFruitAlias(category: PikminCategory, seedText: string): string {
  const pool = FRUIT_ALIASES[category];
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

export function mapPlaidCategory(plaidPrimary?: string | null): PikminCategory | null {
  if (!plaidPrimary) return null;
  const upper = plaidPrimary.toUpperCase();
  if (upper.includes('FOOD_AND_DRINK')) return 'dining';
  if (upper.includes('GROCER')) return 'groceries';
  if (upper.includes('GENERAL_MERCHANDISE') || upper.includes('HOME_IMPROVEMENT')) return 'shopping';
  if (
    upper.includes('RENT_AND_UTILITIES') ||
    upper.includes('TRANSPORTATION') ||
    upper.includes('LOAN') ||
    upper.includes('BANK_FEES') ||
    upper.includes('MEDICAL')
  ) {
    return 'bills';
  }
  if (upper.includes('ENTERTAINMENT') || upper.includes('TRAVEL') || upper.includes('RECREATION')) {
    return 'leisure';
  }
  return null;
}

export function classifyTransaction(
  rawDescription: string,
  amount: number,
  plaidPrimaryCategory?: string | null
): ClassificationResult {
  const merchant = cleanMerchantName(rawDescription);

  let isExcluded = false;
  let excludeReason: ExcludeReason = null;

  if (CARD_PAYMENT_PATTERNS.some((p) => p.test(rawDescription))) {
    isExcluded = true;
    excludeReason = 'card_payment';
  } else if (TRANSFER_PATTERNS.some((p) => p.test(rawDescription))) {
    isExcluded = true;
    excludeReason = 'transfer';
  } else if (INCOME_PATTERNS.some((p) => p.test(rawDescription))) {
    isExcluded = true;
    excludeReason = 'income';
  } else if (amount < 0) {
    isExcluded = true;
    excludeReason = 'refund';
  } else if (plaidPrimaryCategory) {
    const upper = plaidPrimaryCategory.toUpperCase();
    if (upper.startsWith('INCOME')) {
      isExcluded = true;
      excludeReason = 'income';
    } else if (upper.startsWith('TRANSFER') || upper.startsWith('LOAN_PAYMENTS')) {
      isExcluded = true;
      excludeReason = upper.includes('CREDIT_CARD') ? 'card_payment' : 'transfer';
    }
  }

  let category: PikminCategory | null = null;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(rawDescription) || pattern.test(merchant))) {
      category = rule.category;
      break;
    }
  }
  if (!category) {
    category = mapPlaidCategory(plaidPrimaryCategory) ?? 'shopping';
  }

  const fruitAlias = pickFruitAlias(category, `${merchant}:${category}`);

  return {
    merchant,
    category,
    fruitAlias,
    isExcluded,
    excludeReason,
  };
}

export function makeDedupeHash(
  sourceKey: string,
  date: string,
  amount: number,
  rawDescription: string,
  externalId?: string | null
): string {
  const normalized = externalId
    ? `ext:${sourceKey}:${externalId}`
    : `row:${sourceKey}:${date}:${amount.toFixed(2)}:${rawDescription.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

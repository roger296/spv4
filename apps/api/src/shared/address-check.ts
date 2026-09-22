/**
 * Address checking with free data only (spec section 10): postcode format per country,
 * UK outward-code sanity, and required fields. Returns a list of problems; empty means pass.
 * A paid PAF lookup can be added later behind the same function.
 */
export interface AddressToCheck {
  contactName?: string | null;
  line1?: string | null;
  city?: string | null;
  postCode?: string | null;
  country?: string | null;
}

const POSTCODE_PATTERNS: Record<string, RegExp> = {
  GB: /^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i,
  IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/i,
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  BE: /^\d{4}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  DK: /^\d{4}$/,
  NO: /^\d{4}$/,
  SE: /^\d{3} ?\d{2}$/,
  FI: /^\d{5}$/,
  PL: /^\d{2}-\d{3}$/,
  PT: /^\d{4}-\d{3}$/,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  JP: /^\d{3}-?\d{4}$/,
  JE: /^JE\d ?\d[A-Z]{2}$/i,
  GG: /^GY\d{1,2} ?\d[A-Z]{2}$/i,
  IM: /^IM\d{1,2} ?\d[A-Z]{2}$/i,
};

/** Countries where a postcode is genuinely optional. */
const NO_POSTCODE = new Set(['HK', 'AE', 'QA', 'BS', 'BZ', 'BW', 'DM', 'FJ', 'GM', 'GH', 'KE', 'MO', 'MW', 'ML', 'MR', 'NR', 'NG', 'QA', 'RW', 'ST', 'SC', 'SL', 'SB', 'SO', 'SR', 'SY', 'TL', 'TO', 'TV', 'UG', 'VU', 'YE', 'ZW', 'AO', 'AG', 'AW', 'BJ', 'BO', 'BF', 'BI', 'CM', 'CF', 'KM', 'CG', 'CD', 'CK', 'CI', 'DJ', 'GQ', 'ER', 'GA', 'GD', 'GY', 'KI', 'LY', 'MV', 'NU', 'KP', 'PA', 'TG', 'TK', 'AE']);

export function checkAddress(a: AddressToCheck): string[] {
  const issues: string[] = [];
  if (!a.contactName?.trim()) issues.push('Recipient name is missing');
  if (!a.line1?.trim()) issues.push('Address line 1 is missing');
  if (!a.city?.trim()) issues.push('Town or city is missing');
  const country = a.country?.toUpperCase();
  if (!country || country.length !== 2) {
    issues.push('Country is missing or not a two-letter code');
    return issues;
  }
  const pc = (a.postCode ?? '').trim();
  if (!pc) {
    if (!NO_POSTCODE.has(country)) issues.push('Postcode is missing');
    return issues;
  }
  const pattern = POSTCODE_PATTERNS[country];
  if (pattern && !pattern.test(pc)) issues.push(`Postcode ${pc} is not a valid ${country} postcode`);
  if (country === 'GB') {
    const normalised = normaliseUkPostcode(pc);
    if (normalised && a.city && looksLikeWrongTown(normalised, a.city)) issues.push(`Postcode ${normalised} does not match town ${a.city}`);
  }
  return issues;
}

export function normaliseUkPostcode(pc: string): string | null {
  const s = pc.toUpperCase().replace(/\s+/g, '');
  if (s.length < 5 || s.length > 7) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

/** A tiny sanity table: postcode areas whose town is unambiguous. Extend as data shows mismatches. */
const AREA_TOWNS: Record<string, string[]> = {
  M: ['manchester', 'salford', 'stockport', 'sale', 'altrincham', 'bury', 'oldham', 'rochdale', 'ashton', 'wigan', 'bolton', 'trafford', 'stretford', 'urmston', 'prestwich', 'whitefield', 'radcliffe', 'eccles', 'swinton', 'worsley', 'middleton', 'chadderton', 'failsworth', 'denton', 'hyde', 'audenshaw', 'droylsden', 'cheadle', 'wythenshawe', 'didsbury', 'chorlton'],
  SK: ['stockport', 'wilmslow', 'macclesfield', 'cheadle', 'bramhall', 'poynton', 'hazel grove', 'marple', 'hyde', 'glossop', 'buxton', 'alderley edge', 'handforth', 'romiley', 'bredbury', 'gatley', 'knutsford', 'chapel-en-le-frith', 'whaley bridge', 'new mills', 'disley', 'bollington', 'prestbury', 'stalybridge', 'dukinfield', 'mottram'],
  L: ['liverpool', 'bootle', 'crosby', 'formby', 'southport', 'kirkby', 'huyton', 'prescot', 'maghull', 'ormskirk', 'wallasey', 'birkenhead', 'litherland', 'aintree', 'halewood', 'garston', 'speke', 'woolton', 'allerton', 'anfield', 'walton', 'norris green', 'west derby', 'knowsley'],
};

function looksLikeWrongTown(postcode: string, town: string): boolean {
  const area = /^[A-Z]+/.exec(postcode)?.[0];
  if (!area) return false;
  const towns = AREA_TOWNS[area];
  if (!towns) return false;
  const t = town.trim().toLowerCase();
  // Only flag when the town is unambiguously another listed area's main town.
  const otherMainTowns = Object.entries(AREA_TOWNS).filter(([k]) => k !== area).map(([, v]) => v[0]!);
  return otherMainTowns.includes(t) && !towns.includes(t);
}

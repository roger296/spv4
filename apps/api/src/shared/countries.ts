/**
 * Country normalisation. Everything is stored as ISO 3166-1 alpha-2; input may be a
 * name, alpha-2 or alpha-3. Names are the common English ones plus the spellings the
 * old Smooth Parcel data used.
 */
const ALPHA3: Record<string, string> = {
  GBR: 'GB', IRL: 'IE', FRA: 'FR', DEU: 'DE', ESP: 'ES', ITA: 'IT', NLD: 'NL', BEL: 'BE', PRT: 'PT', AUT: 'AT',
  DNK: 'DK', SWE: 'SE', FIN: 'FI', POL: 'PL', LUX: 'LU', USA: 'US', CAN: 'CA', AUS: 'AU', NZL: 'NZ', CHE: 'CH',
  NOR: 'NO', JPN: 'JP', CHN: 'CN', HKG: 'HK', SGP: 'SG', ARE: 'AE', IND: 'IN', PAK: 'PK', ZAF: 'ZA', BRA: 'BR',
  MEX: 'MX', CZE: 'CZ', HUN: 'HU', ROU: 'RO', GRC: 'GR', HRV: 'HR', SVK: 'SK', SVN: 'SI', BGR: 'BG', LTU: 'LT',
  LVA: 'LV', EST: 'EE', MLT: 'MT', CYP: 'CY', ISL: 'IS', TUR: 'TR', ISR: 'IL', KOR: 'KR', TWN: 'TW', THA: 'TH',
  MYS: 'MY', IDN: 'ID', PHL: 'PH', VNM: 'VN', SAU: 'SA', QAT: 'QA', EGY: 'EG', NGA: 'NG', KEN: 'KE', ARG: 'AR',
  CHL: 'CL', COL: 'CO', PER: 'PE', JEY: 'JE', GGY: 'GG', IMN: 'IM', GIB: 'GI', UKR: 'UA', SRB: 'RS', ZWE: 'ZW', ZMB: 'ZM',
};

const NAMES: Record<string, string> = {
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  ireland: 'IE', 'republic of ireland': 'IE', 'ireland, republic of': 'IE', eire: 'IE',
  france: 'FR', germany: 'DE', spain: 'ES', italy: 'IT', netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL',
  belgium: 'BE', portugal: 'PT', austria: 'AT', denmark: 'DK', sweden: 'SE', finland: 'FI', poland: 'PL', luxembourg: 'LU',
  'united states': 'US', usa: 'US', 'united states of america': 'US', america: 'US', canada: 'CA', australia: 'AU',
  'new zealand': 'NZ', switzerland: 'CH', norway: 'NO', japan: 'JP', china: 'CN', 'china, peoples rep.': 'CN',
  'hong kong': 'HK', singapore: 'SG', 'united arab emirates': 'AE', uae: 'AE', india: 'IN', pakistan: 'PK',
  'south africa': 'ZA', brazil: 'BR', mexico: 'MX', 'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', romania: 'RO',
  greece: 'GR', croatia: 'HR', slovakia: 'SK', slovenia: 'SI', bulgaria: 'BG', lithuania: 'LT', latvia: 'LV', estonia: 'EE',
  malta: 'MT', cyprus: 'CY', iceland: 'IS', turkey: 'TR', israel: 'IL', 'south korea': 'KR', 'korea, republic of': 'KR',
  taiwan: 'TW', thailand: 'TH', malaysia: 'MY', indonesia: 'ID', philippines: 'PH', vietnam: 'VN', 'viet nam': 'VN',
  'saudi arabia': 'SA', qatar: 'QA', egypt: 'EG', nigeria: 'NG', kenya: 'KE', argentina: 'AR', chile: 'CL', colombia: 'CO',
  peru: 'PE', jersey: 'JE', guernsey: 'GG', 'isle of man': 'IM', gibraltar: 'GI', ukraine: 'UA', serbia: 'RS',
  zimbabwe: 'ZW', zambia: 'ZM', 'channel islands': 'JE',
};

const VALID_ALPHA2 = new Set([
  ...Object.values(ALPHA3), ...Object.values(NAMES),
  'AF','AL','DZ','AS','AD','AO','AI','AG','AM','AW','AZ','BS','BH','BD','BB','BY','BZ','BJ','BM','BT','BO','BA','BW','BN','BF','BI','KH','CM','CV','KY','CF','TD','KM','CG','CD','CK','CR','CI','CU','CW','DJ','DM','DO','EC','SV','GQ','ER','ET','FK','FO','FJ','GF','PF','GA','GM','GE','GH','GL','GD','GP','GU','GT','GN','GW','GY','HT','HN','IR','IQ','JM','JO','KZ','KI','KW','KG','LA','LB','LS','LR','LY','LI','MO','MK','MG','MW','MV','ML','MH','MQ','MR','MU','YT','FM','MD','MC','MN','ME','MS','MA','MZ','MM','NA','NR','NP','NC','NI','NE','NU','KP','MP','OM','PW','PS','PA','PG','PY','PR','RE','RU','RW','BL','KN','LC','PM','VC','WS','SM','ST','SN','SC','SL','SX','SB','SO','SS','LK','SD','SR','SZ','SY','TJ','TZ','TL','TG','TO','TT','TN','TM','TC','TV','UG','UY','UZ','VU','VE','VG','VI','WF','YE','VA','LK','MF','BQ','AX','SJ','GS','HM','IO','TF','UM','EH','CX','CC','NF','PN','SH','TK','AQ','BV','FK',
]);

export function toAlpha2(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper.length === 2 && VALID_ALPHA2.has(upper)) return upper;
  if (upper.length === 3 && ALPHA3[upper]) return ALPHA3[upper]!;
  const byName = NAMES[s.toLowerCase().replace(/\s+/g, ' ')];
  return byName ?? null;
}

export function isValidAlpha2(code: string): boolean {
  return VALID_ALPHA2.has(code.toUpperCase());
}

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);

export function isEu(code: string): boolean {
  return EU.has(code);
}

/** Customs paperwork is needed when goods leave the UK customs territory. */
export function needsCustoms(origin: string, destination: string): boolean {
  if (origin === destination) return false;
  if (origin === 'GB' && ['JE', 'GG', 'IM'].includes(destination)) return true; // Channel Islands and IoM need CN22/23
  return true;
}

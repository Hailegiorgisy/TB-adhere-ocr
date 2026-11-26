export interface ExtractedTBRecord {
  idempotencyKey: string;
  hcCode: string;
  tbRegisterNo: string;
  age: number | null;
  sex: 'M' | 'F' | '';
  ketena: string;
  tbType: 'PTB_POS' | 'PTB_NEG' | 'EPTB' | 'DR_TB' | '';
  hivStatus: 'POS' | 'NEG' | 'UNKNOWN';
  patientPhone: string;
  supporterPhone: string;
  treatmentStartDate: string;
  meanOcrConfidence: number;
  lowConfidenceFields: string[];
  ltfuRiskScore: number;
  riskTier: 'HIGH' | 'STANDARD';
}

export function normalizeEthiopianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) return `+${digits}`;
  if ((digits.startsWith('09') || digits.startsWith('07')) && digits.length === 10) {
    return `+251${digits.slice(1)}`;
  }
  if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
    return `+251${digits}`;
  }
  return raw.trim();
}

export function isValidEthiopianPhone(phone: string): boolean {
  return /^\+251(9|7)\d{8}$/.test(phone);
}

/**
 * Parses raw on-device OCR text blocks from a single horizontal row
 * of the Ethiopian National TB Unit Register into structured clinical fields.
 */
export function parseTBRegisterRow(
  rawText: string,
  hcCode: string,
  blockConfidences: number[] = []
): ExtractedTBRecord {
  const cleaned = rawText
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lowConfidenceFields: string[] = [];

  // 1. Extract TB Register Number (e.g., 042/26, AA-042/26, or 104/19)
  const regMatch = cleaned.match(/\b(?:[A-Z]{2}-)?\d{2,4}\/\d{2,4}\b/i);
  const tbRegisterNo = regMatch ? regMatch[0].toUpperCase() : '';
  if (!tbRegisterNo) lowConfidenceFields.push('tbRegisterNo');

  // 2. Extract Sex (M/F) & Age (0-110)
  let sex: 'M' | 'F' | '' = '';
  const sexMatch = cleaned.match(/\b(M|F|MALE|FEMALE)\b/i);
  if (sexMatch) {
    sex = sexMatch[1].toUpperCase().startsWith('M') ? 'M' : 'F';
  } else {
    lowConfidenceFields.push('sex');
  }

  let age: number | null = null;
  const ageMatch = cleaned.match(/\b(\d{1,2})\s*(?:Y|YR|YRS)?\b/i);
  if (ageMatch) {
    const parsedAge = parseInt(ageMatch[1], 10);
    if (parsedAge >= 1 && parsedAge <= 110) age = parsedAge;
  }
  if (age === null) lowConfidenceFields.push('age');

  // 3. Extract TB Classification (PTB+, PTB-, EPTB, DR-TB)
  let tbType: ExtractedTBRecord['tbType'] = '';
  if (/DR[-\s]?TB|MDR/i.test(cleaned)) tbType = 'DR_TB';
  else if (/EPTB|EP\b/i.test(cleaned)) tbType = 'EPTB';
  else if (/PTB\s*\+|P\/POS|POS\b/i.test(cleaned)) tbType = 'PTB_POS';
  else if (/PTB\s*-|P\/NEG|NEG\b/i.test(cleaned)) tbType = 'PTB_NEG';
  if (!tbType) lowConfidenceFields.push('tbType');

  // 4. Extract HIV Status (POS / NEG / UNKNOWN)
  let hivStatus: ExtractedTBRecord['hivStatus'] = 'UNKNOWN';
  if (/HIV\s*\+|HIV\s*POS|\bR\b/i.test(cleaned)) hivStatus = 'POS';
  else if (/HIV\s*-|HIV\s*NEG|\bNR\b/i.test(cleaned)) hivStatus = 'NEG';
  else lowConfidenceFields.push('hivStatus');

  // 5. Extract Ethiopian Phone Numbers (1st = Patient, 2nd = Treatment Supporter)
  const phoneMatches = cleaned.match(/(?:\+?251|0)?[97]\d[\s-]?\d{3}[\s-]?\d{4}/g) || [];
  const patientPhone = phoneMatches[0] ? normalizeEthiopianPhone(phoneMatches[0]) : '';
  const supporterPhone = phoneMatches[1] ? normalizeEthiopianPhone(phoneMatches[1]) : '';
  if (!isValidEthiopianPhone(patientPhone)) lowConfidenceFields.push('patientPhone');
  if (!isValidEthiopianPhone(supporterPhone)) lowConfidenceFields.push('supporterPhone');

  // 6. Extract Ketena / Kebele (e.g., K-03 or Ketena 08)
  const ketenaMatch = cleaned.match(/(?:KETENA|K)[-\s]?(\d{1,2})/i);
  const ketena = ketenaMatch ? `Ketena ${ketenaMatch[1].padStart(2, '0')}` : 'Ketena 01';

  const meanOcrConfidence =
    blockConfidences.length > 0
      ? Number((blockConfidences.reduce((a, b) => a + b, 0) / blockConfidences.length).toFixed(2))
      : 0.94;

  const { score, tier } = computeLtfuRiskScore({
    age: age ?? 30,
    sex: sex || 'M',
    tbType: tbType || 'PTB_POS',
    hivStatus,
    hasSupporterPhone: isValidEthiopianPhone(supporterPhone),
  });

  const today = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `${hcCode}:${tbRegisterNo || Date.now()}:${today}`;

  return {
    idempotencyKey,
    hcCode,
    tbRegisterNo,
    age,
    sex,
    ketena,
    tbType,
    hivStatus,
    patientPhone,
    supporterPhone,
    treatmentStartDate: today,
    meanOcrConfidence,
    lowConfidenceFields,
    ltfuRiskScore: score,
    riskTier: tier,
  };
}

/**
 * Embedded baseline LTFU Risk Stratification Model (>0.20 = HIGH RISK)
 */
export function computeLtfuRiskScore(params: {
  age: number;
  sex: string;
  tbType: string;
  hivStatus: string;
  hasSupporterPhone: boolean;
}): { score: number; tier: 'HIGH' | 'STANDARD' } {
  let logit = -1.85; // Baseline ~13.6%
  if (params.hivStatus === 'POS') logit += 0.85;
  if (params.tbType === 'DR_TB') logit += 1.15;
  if (params.tbType === 'EPTB') logit += 0.25;
  if (params.age >= 18 && params.age <= 35 && params.sex === 'M') logit += 0.42; // Mobile urban daily worker risk
  if (!params.hasSupporterPhone) logit += 0.65;

  const prob = 1 / (1 + Math.exp(-logit));
  const score = Number(prob.toFixed(4));
  return {
    score,
    tier: score > 0.2 ? 'HIGH' : 'STANDARD',
  };
}

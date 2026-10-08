// @editedBy SherrySherry 2026-10-08
/** CSV 타입 계수와 명시적으로 집계한 N으로 언급 점수 항을 계산한다. */

export interface MentionCoefficients {
  readonly typeId: number;
  readonly typeName: string;
  readonly alpha: number;
  readonly beta: number;
  readonly description: string;
}

const CSV_HEADER = ['type_id', 'type_name', 'alpha', 'beta', 'description'];

/** 따옴표 안의 쉼표·줄바꿈·겹따옴표를 원문대로 보존한다. */
function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const finishField = (): void => {
    row.push(field);
    field = '';
    state = 'start';
  };
  const finishRow = (): void => {
    finishField();
    if (row.length !== 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else state = 'closed';
      continue;
    }
    if (char === ',') {
      finishField();
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && state === 'start') {
      state = 'quoted';
    } else {
      if (state === 'closed' || char === '"') throw new Error('Invalid quoting in mention coefficients CSV');
      field += char;
      state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('Unclosed quote in mention coefficients CSV');
  if (row.length > 0 || field !== '' || state !== 'start') finishRow();
  return rows;
}

function csvNumber(value: string, column: string, row: number): number {
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    throw new Error(`Invalid ${column} in mention coefficients CSV row ${row}`);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) throw new RangeError(`Non-finite ${column} in mention coefficients CSV row ${row}`);
  return number;
}

function validateCoefficients(alpha: number, beta: number): void {
  if (!Number.isFinite(alpha) || alpha <= 0 || !Number.isFinite(beta) || beta <= 1) {
    throw new RangeError('Mention coefficients require finite alpha > 0 and beta > 1');
  }
}

/**
 * UTF-8 BOM CSV를 고정 type_id 기준으로 읽는다. 표시 이름·설명은 해석하지 않는다.
 * 숫자 오류나 중복 ID가 있으면 표 전체를 거부하며 임의 계수로 대체하지 않는다.
 * 파일 읽기·설정 보관은 호출자가 담당한다. 저장된 쩜의 type 필드를 변환하지 않는다.
 */
export function parseMentionCoefficientsCsv(csv: string): ReadonlyMap<number, MentionCoefficients> {
  const [header, ...rows] = csvRows(csv);
  if (!header || header.length !== CSV_HEADER.length || header.some((value, i) => value !== CSV_HEADER[i])) {
    throw new Error('Expected mention coefficients CSV header: type_id,type_name,alpha,beta,description');
  }
  if (rows.length === 0) throw new Error('Mention coefficients CSV has no type rows');
  const table = new Map<number, MentionCoefficients>();
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    if (row.length !== CSV_HEADER.length) throw new Error(`Expected 5 columns in mention coefficients CSV row ${rowNumber}`);
    const [idText, typeName, alphaText, betaText, description] = row;
    const typeId = csvNumber(idText, 'type_id', rowNumber);
    if (!Number.isSafeInteger(typeId) || typeId < 1) throw new RangeError(`Invalid type_id in mention coefficients CSV row ${rowNumber}`);
    if (table.has(typeId)) throw new Error(`Duplicate type_id in mention coefficients CSV row ${rowNumber}`);
    if (!typeName.trim()) throw new Error(`Empty type_name in mention coefficients CSV row ${rowNumber}`);
    const alpha = csvNumber(alphaText, 'alpha', rowNumber);
    const beta = csvNumber(betaText, 'beta', rowNumber);
    validateCoefficients(alpha, beta);
    table.set(typeId, Object.freeze({ typeId, typeName, alpha, beta, description }));
  }
  return table;
}

/**
 * M = alpha * log_beta(N). 복수 타입은 alpha의 산술평균과 beta의 최댓값을 쓴다.
 * 같은 type_id는 한 번만 반영한다. 단일 ID 또는 하나 이상의 ID 배열을 받는다.
 * N은 호출자가 확인한 사용자 선행 언급 횟수(정수, 1 이상)다.
 * 단편 대화 단위의 집계·중복 방지·점수 누적은 호출자가 담당한다.
 * 이 함수는 이어진 세션 전체를 다시 분석하거나 누적 점수를 저장하지 않는다.
 * 이 언급 항은 매 발화 새로 계산하는 회상 점수와 별개다.
 * v4 mentionCount를 자동 대입하지 않으며, 파워 합산·회상 점수 계산·저장은 하지 않는다.
 * N=1이면 언급 항은 0이다. 미정인 전체 파워 표시 규칙으로 반올림하거나 하한을 올리지 않는다.
 */
export function calculateMentionScore(
  table: ReadonlyMap<number, MentionCoefficients>,
  typeIds: number | readonly number[],
  userInitiatedMentionCount: number,
): number {
  if (!Number.isSafeInteger(userInitiatedMentionCount) || userInitiatedMentionCount < 1) {
    throw new RangeError('N must be a positive safe integer');
  }
  const uniqueTypeIds = new Set(typeof typeIds === 'number' ? [typeIds] : typeIds);
  if (uniqueTypeIds.size === 0) throw new RangeError('At least one type_id is required');
  let alpha = 0;
  let beta = 1;
  let count = 0;
  for (const typeId of uniqueTypeIds) {
    if (!Number.isSafeInteger(typeId) || typeId < 1) throw new RangeError('typeId must be a positive safe integer');
    const coefficients = table.get(typeId);
    if (!coefficients) throw new RangeError(`No mention coefficients for type_id ${typeId}`);
    validateCoefficients(coefficients.alpha, coefficients.beta);
    // 양의 유한한 계수의 합이 수치 범위를 넘지 않도록 산술평균을 단계별로 구한다.
    alpha += (coefficients.alpha - alpha) / ++count;
    beta = Math.max(beta, coefficients.beta);
  }
  const score = alpha * (Math.log(userInitiatedMentionCount) / Math.log(beta));
  if (!Number.isFinite(score)) throw new RangeError('Mention score exceeds the finite numeric range');
  return score;
}

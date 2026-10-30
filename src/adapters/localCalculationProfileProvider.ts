// @editedBy SherrySherry 2026-10-30
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  CalculationProfileError, profilePairKey,
  type CalculationProfile, type CalculationProfileProvider, type CalculationProfileSelection,
  type ProfileTypeCoefficients, type UpperLowerValues,
} from '../calculationProfiles.ts';

type JsonObject = Record<string, unknown>;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalculationProfileError('invalid', `${label} must be an object`);
  return value as JsonObject;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new CalculationProfileError('invalid', `${label} must be a nonempty string`);
  return value;
}
function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function number(value: unknown, label: string, lower = 0): number {
  if (typeof value === 'string') {
    if (!numeric.test(value)) throw new CalculationProfileError('invalid', `${label} must contain a numeric value`);
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lower) {
    throw new CalculationProfileError('invalid', `${label} must be finite and at least ${lower}`);
  }
  return value;
}

/** BOM·따옴표·필드 안 개행을 처리한다. 빈 숫자를 0으로 바꾸지 않는다. */
export function parseCalculationCsv(input: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], field = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const finishField = () => { row.push(field); field = ''; state = 'start'; };
  const finishRow = () => { finishField(); if (row.length !== 1 || row[0] !== '') rows.push(row); row = []; };
  const source = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (state === 'quoted') {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else state = 'closed';
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') { finishRow(); if (char === '\r' && source[i + 1] === '\n') i++; }
    else if (char === '"' && state === 'start') state = 'quoted';
    else {
      if (state === 'closed' || char === '"') throw new CalculationProfileError('invalid', 'Invalid CSV quoting');
      field += char; state = 'plain';
    }
  }
  if (state === 'quoted') throw new CalculationProfileError('invalid', 'Unclosed CSV quote');
  if (row.length || field || state !== 'start') finishRow();
  const header = rows.shift();
  if (!header?.length || header.some(name => !name.trim()) || new Set(header).size !== header.length) {
    throw new CalculationProfileError('invalid', 'CSV requires unique nonempty columns');
  }
  return rows.map(values => {
    if (values.length !== header.length) throw new CalculationProfileError('invalid', 'CSV row has an unexpected column count');
    return Object.fromEntries(header.map((name, i) => [name, values[i]]));
  });
}

/** 파일 위치는 구성에서만 주입한다. 기본 개인 프로필이나 배포 경로는 코드에 없다. */
export class LocalCalculationProfileProvider implements CalculationProfileProvider {
  private readonly entryPoints: readonly string[];
  private readonly observedVersions = new Map<string, string>();
  constructor(options: { entryPoints: readonly string[] }) {
    if (!Array.isArray(options.entryPoints) || !options.entryPoints.length) {
      throw new CalculationProfileError('invalid', 'At least one profile entry point is required');
    }
    this.entryPoints = options.entryPoints.map(value => resolve(text(value, 'entryPoint')));
  }

  async load(selection: CalculationProfileSelection): Promise<CalculationProfile> {
    text(selection.profileId, 'profileId'); text(selection.profileVersion, 'profileVersion');
    let selected: CalculationProfile | undefined;
    for (const entryPoint of this.entryPoints) {
      const candidate = this.read(entryPoint, selection);
      if (!candidate) continue;
      if (selected && (selected.coefficientDigest !== candidate.coefficientDigest
          || selected.seonRuleDigest !== candidate.seonRuleDigest || selected.seonRuleVersion !== candidate.seonRuleVersion)) {
        throw new CalculationProfileError('ambiguous', 'The selected profile has conflicting package contents');
      }
      selected ??= candidate;
    }
    if (!selected) throw new CalculationProfileError('unavailable', 'The requested profile and version are not configured');
    const key = JSON.stringify([selected.profileId, selected.profileVersion]);
    const previous = this.observedVersions.get(key);
    if (previous && previous !== selected.coefficientDigest) {
      throw new CalculationProfileError('integrity', 'Coefficients changed without a profile version change');
    }
    this.observedVersions.set(key, selected.coefficientDigest);
    return selected;
  }

  private read(entryPoint: string, selection: CalculationProfileSelection): CalculationProfile | undefined {
    try {
      const file = realpathSync(entryPoint), root = dirname(file);
      const contents = new Map<string, Buffer>();
      const read = (name: string): Buffer => {
        text(name, 'profile asset path');
        if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new CalculationProfileError('invalid', 'Profile asset path escapes its package');
        const target = realpathSync(resolve(root, name));
        const rel = relative(root, target);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new CalculationProfileError('invalid', 'Profile asset path escapes its package');
        const stat = statSync(target);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new CalculationProfileError('invalid', 'Profile asset is not a supported regular file');
        const bytes = readFileSync(target);
        contents.set(name, bytes);
        return bytes;
      };
      const manifestName = relative(root, file);
      const manifest = object(JSON.parse(read(manifestName).toString('utf8')), 'profile');
      const profileId = text(manifest.profileId, 'profileId'), profileVersion = text(manifest.profileVersion, 'profileVersion');
      if (profileId !== selection.profileId || profileVersion !== selection.profileVersion) return undefined;
      if (manifest.exportFormatVersion !== 1 || manifest.scope !== 'individual') {
        throw new CalculationProfileError('invalid', 'Unsupported calculation profile format or scope');
      }
      const packageVersion = manifest.packageVersion === undefined ? undefined : text(manifest.packageVersion, 'packageVersion');
      const formulaVariants = object(manifest.formulaVariants, 'formulaVariants');
      for (const [name, a, b, expression] of [
        ['root', 'rootAlpha', 'rootBeta', 'alpha * (N^(1/beta) - 1)'],
        ['logarithm', 'logAlpha', 'logBeta', 'alpha * log(N) / log(beta)'],
      ]) {
        const variant = object(formulaVariants[name], `formulaVariants.${name}`);
        if (variant.alphaField !== a || variant.betaField !== b || variant.minimumN !== 1 || variant.expression !== expression) {
          throw new CalculationProfileError('invalid', 'The profile declares an unsupported mention formula');
        }
      }
      const tables = object(manifest.tables, 'tables');
      const table = (name: string): { path: string; rows: Array<Record<string, string>> } => {
        const spec = object(tables[name], `tables.${name}`);
        const path = text(spec.file, `tables.${name}.file`);
        const rows = parseCalculationCsv(read(path).toString('utf8'));
        if (!Number.isSafeInteger(spec.rows) || (spec.rows as number) < 1 || spec.rows !== rows.length) {
          throw new CalculationProfileError('invalid', 'Profile table row count differs from its declaration');
        }
        return { path, rows };
      };
      const coefficientTable = table('coefficients');
      const types = new Map<string, ProfileTypeCoefficients>();
      for (const row of coefficientTable.rows) {
        const name = text(row.name, 'type name');
        if (types.has(name)) throw new CalculationProfileError('invalid', 'Duplicate profile type');
        if (row.participatesInGeneralLinkMatrices !== 'true' && row.participatesInGeneralLinkMatrices !== 'false') {
          throw new CalculationProfileError('invalid', 'Invalid matrix participation flag');
        }
        const values: ProfileTypeCoefficients = { name, category: text(row.category, 'type category'),
          basePower: number(row.basePower, 'basePower'), rootAlpha: number(row.rootAlpha, 'rootAlpha'),
          rootBeta: number(row.rootBeta, 'rootBeta'), logAlpha: number(row.logAlpha, 'logAlpha'),
          logBeta: number(row.logBeta, 'logBeta'), participatesInGeneralLinkMatrices: row.participatesInGeneralLinkMatrices === 'true' };
        if (values.rootAlpha <= 0 || values.logAlpha <= 0 || values.rootBeta <= 1 || values.logBeta <= 1) {
          throw new CalculationProfileError('invalid', 'Mention coefficients require alpha > 0 and beta > 1');
        }
        types.set(name, Object.freeze(values));
      }
      if (!Array.isArray(manifest.types) || manifest.types.length !== types.size) throw new CalculationProfileError('invalid', 'Profile type declarations differ from the coefficient table');
      const declaredNames = new Set<string>();
      for (const item of manifest.types) {
        const declaration = object(item, 'profile type');
        const name = text(declaration.name, 'profile type name');
        if (declaredNames.has(name)) throw new CalculationProfileError('invalid', 'Duplicate profile type declaration');
        declaredNames.add(name);
        const values = types.get(name);
        if (!values || Object.entries(values).some(([key, value]) => declaration[key] !== value)) {
          throw new CalculationProfileError('integrity', 'Profile JSON and coefficient CSV do not agree');
        }
      }
      const matrixTypes = new Set([...types.values()].filter(type => type.participatesInGeneralLinkMatrices).map(type => type.name));
      const readMatrix = (name: 'general' | 'parentChild' | 'upperLower') => {
        const loaded = table(name);
        const expected = name === 'general' ? ['typeA', 'typeB', 'sharedValue']
          : name === 'parentChild' ? ['parentType', 'childType', 'sharedValue']
          : ['upperType', 'lowerType', 'upperReceived', 'lowerReceived', 'sourceDisplay'];
        if (!loaded.rows.length || Object.keys(loaded.rows[0]).join('\0') !== expected.join('\0')) {
          throw new CalculationProfileError('invalid', 'Unexpected seon table columns');
        }
        const rows = new Map<string, number | UpperLowerValues>();
        for (const row of loaded.rows) {
          const first = row[expected[0]], second = row[expected[1]];
          if (!matrixTypes.has(first) || !matrixTypes.has(second)) throw new CalculationProfileError('invalid', 'Seon table refers to an unsupported type');
          const key = profilePairKey(first, second);
          if (rows.has(key)) throw new CalculationProfileError('invalid', 'Duplicate ordered type pair');
          rows.set(key, name === 'upperLower'
            ? Object.freeze({ upperReceived: number(row.upperReceived, 'upperReceived'), lowerReceived: number(row.lowerReceived, 'lowerReceived') })
            : number(row.sharedValue, 'sharedValue'));
        }
        if (rows.size !== matrixTypes.size ** 2) throw new CalculationProfileError('invalid', 'Seon table does not cover all declared matrix types');
        if (name !== 'upperLower') {
          for (const a of matrixTypes) for (const b of matrixTypes) {
            if (rows.get(profilePairKey(a, b)) !== rows.get(profilePairKey(b, a))) throw new CalculationProfileError('integrity', 'Shared seon values are not symmetric');
          }
        }
        return { path: loaded.path, rows };
      };
      const general = readMatrix('general'), parentChild = readMatrix('parentChild'), upperLower = readMatrix('upperLower');
      const policy = object(object(manifest.policies, 'policies').seon, 'policies.seon');
      const ruleVersion = text(policy.documentVersion, 'seon rule documentVersion');
      const ruleBytes = read(text(policy.file, 'seon rules path'));
      if (!ruleBytes.toString('utf8').trim()) throw new CalculationProfileError('invalid', 'Seon rules document is empty');
      const checksums = new Map<string, string>();
      for (const line of read('checksums.sha256').toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = /^([0-9a-f]{64})  (.+)$/i.exec(line);
        if (!match || checksums.has(match[2])) throw new CalculationProfileError('invalid', 'Invalid checksum list');
        checksums.set(match[2], match[1].toLowerCase());
      }
      for (const [name, bytes] of contents) {
        if (name === 'checksums.sha256') continue;
        if (checksums.get(name) !== digest(bytes)) throw new CalculationProfileError('integrity', 'Profile asset checksum does not match');
      }
      // 개인 표시명·설명·CSV 포장 형식은 계산 계수의 동일성에 포함하지 않는다.
      const coefficientDigest = digest(JSON.stringify({ formulas: ['root', 'logarithm'].map(name => {
        const f = object(formulaVariants[name], name); return [f.expression, f.minimumN, f.alphaField, f.betaField];
      }), types: [...types].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      tables: [general.rows, parentChild.rows, upperLower.rows].map(rows => [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }));
      return { profileId, profileVersion, scope: 'individual', ...(packageVersion ? { packageVersion } : {}),
        seonRuleVersion: ruleVersion, coefficientDigest, seonRuleDigest: digest(ruleBytes), types,
        general: general.rows as ReadonlyMap<string, number>, parentChild: parentChild.rows as ReadonlyMap<string, number>,
        upperLower: upperLower.rows as ReadonlyMap<string, UpperLowerValues> };
    } catch (cause) {
      if (cause instanceof CalculationProfileError) throw cause;
      throw new CalculationProfileError('unavailable', 'Calculation profile cannot be read', { cause });
    }
  }
}

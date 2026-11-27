import { parse } from 'csv-parse/sync';
import crypto from 'node:crypto';
import { db, logSync } from './db.ts';
import { classifyTransaction, makeDedupeHash } from './categorizer.ts';

export interface CsvColumnMapping {
  dateCol: string;
  descriptionCol: string;
  amountCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  categoryCol: string | null;
  signConvention: 'auto' | 'positive_is_spend' | 'negative_is_spend';
}

export interface CsvPreviewRow {
  date: string;
  rawDescription: string;
  merchant: string;
  amount: number;
  category: string;
  fruitAlias: string;
  isExcluded: boolean;
  excludeReason: string | null;
  isDuplicate: boolean;
}

export interface CsvPreviewResult {
  headers: string[];
  detectedMapping: CsvColumnMapping;
  totalRows: number;
  validRows: number;
  purchaseCount: number;
  excludedCount: number;
  duplicateCount: number;
  sampleRows: CsvPreviewRow[];
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const usMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (usMatch) {
    const [, m, d, yRaw] = usMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function parseCurrency(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return negative ? -num : num;
}

function findHeader(headers: string[], candidates: RegExp[]): string | null {
  for (const regex of candidates) {
    const found = headers.find((h) => regex.test(h.trim()));
    if (found) return found;
  }
  return null;
}

export function detectCsvMapping(
  headers: string[],
  records: Record<string, string>[]
): CsvColumnMapping {
  const dateCol =
    findHeader(headers, [
      /^transaction\s*date$/i,
      /^trans\.?\s*date$/i,
      /^date$/i,
      /^posting\s*date$/i,
      /^post\s*date$/i,
      /date/i,
    ]) ??
    headers[0] ??
    '';

  const descriptionCol =
    findHeader(headers, [
      /^description$/i,
      /^merchant(\s*name)?$/i,
      /^name$/i,
      /^payee$/i,
      /^memo$/i,
      /^details$/i,
      /desc|merchant|payee|name/i,
    ]) ??
    headers[1] ??
    headers[0] ??
    '';

  const debitCol = findHeader(headers, [/^debit$/i, /^withdrawal/i, /^outflow$/i, /debit/i]);
  const creditCol = findHeader(headers, [/^credit$/i, /^deposit/i, /^inflow$/i, /credit/i]);
  const amountCol =
    debitCol && creditCol
      ? null
      : findHeader(headers, [/^amount(\s*\(usd\))?$/i, /^total$/i, /^value$/i, /amount/i]) ??
        headers[2] ??
        null;

  const categoryCol = findHeader(headers, [/^category$/i, /^type$/i, /category/i]);

  let signConvention: CsvColumnMapping['signConvention'] = 'positive_is_spend';
  if (amountCol) {
    let negSpend = 0;
    let posSpend = 0;
    let posPayment = 0;
    let negPayment = 0;
    for (const rec of records.slice(0, 40)) {
      const val = parseCurrency(rec[amountCol]);
      if (val === null || val === 0) continue;
      const desc = (rec[descriptionCol] ?? '').toLowerCase();
      const looksLikeCredit = /payment\s*thank\s*you|autopay|payroll|direct\s*dep|refund|credit/i.test(
        desc
      );
      if (looksLikeCredit) {
        if (val > 0) posPayment++;
        else negPayment++;
      } else if (val < 0) {
        negSpend++;
      } else {
        posSpend++;
      }
    }
    if (negSpend > posSpend || (negSpend === posSpend && posPayment > negPayment)) {
      signConvention = 'negative_is_spend';
    }
  }

  return {
    dateCol,
    descriptionCol,
    amountCol,
    debitCol,
    creditCol,
    categoryCol,
    signConvention,
  };
}

function parseRecords(csvText: string): { headers: string[]; records: Record<string, string>[] } {
  const cleaned = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    return { headers: [], records: [] };
  }
  const records = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, records };
}

function extractAmount(
  record: Record<string, string>,
  mapping: CsvColumnMapping
): number | null {
  if (mapping.debitCol && mapping.creditCol && !mapping.amountCol) {
    const debit = parseCurrency(record[mapping.debitCol]);
    const credit = parseCurrency(record[mapping.creditCol]);
    if (debit !== null && debit !== 0) return Math.abs(debit);
    if (credit !== null && credit !== 0) return -Math.abs(credit);
    return null;
  }

  if (!mapping.amountCol) return null;
  const rawVal = parseCurrency(record[mapping.amountCol]);
  if (rawVal === null || rawVal === 0) return null;

  if (mapping.signConvention === 'negative_is_spend') {
    return -rawVal;
  }
  return rawVal;
}

export async function previewCsv(
  csvText: string,
  accountLabel: string,
  overrideMapping?: Partial<CsvColumnMapping>
): Promise<CsvPreviewResult> {
  const { headers, records } = parseRecords(csvText);
  const auto = detectCsvMapping(headers, records);
  const mapping: CsvColumnMapping = {
    ...auto,
    ...overrideMapping,
    signConvention:
      overrideMapping?.signConvention && overrideMapping.signConvention !== 'auto'
        ? overrideMapping.signConvention
        : auto.signConvention,
  };

  const seenInBatch = new Set<string>();

  let validRows = 0;
  let purchaseCount = 0;
  let excludedCount = 0;
  let duplicateCount = 0;
  const sampleRows: CsvPreviewRow[] = [];

  const sourceKey = `csv:${accountLabel.trim().toLowerCase() || 'uploaded-card'}`;

  for (const rec of records) {
    const date = normalizeDate(rec[mapping.dateCol] ?? '');
    const rawDescription = (rec[mapping.descriptionCol] ?? '').trim();
    const amount = extractAmount(rec, mapping);
    if (!date || !rawDescription || amount === null) continue;

    validRows++;
    const roundedAmount = Math.round(amount * 100) / 100;
    const hash = makeDedupeHash(sourceKey, date, roundedAmount, rawDescription);
    const existingRow = await db.get('SELECT 1 FROM transactions WHERE dedupe_hash = ?', [hash]);
    const isDuplicate = Boolean(existingRow) || seenInBatch.has(hash);
    seenInBatch.add(hash);

    const hintCat = mapping.categoryCol ? rec[mapping.categoryCol] : null;
    const classified = classifyTransaction(rawDescription, roundedAmount, hintCat);

    if (isDuplicate) duplicateCount++;
    else if (classified.isExcluded) excludedCount++;
    else purchaseCount++;

    if (sampleRows.length < 25) {
      sampleRows.push({
        date,
        rawDescription,
        merchant: classified.merchant,
        amount: roundedAmount,
        category: classified.category,
        fruitAlias: classified.fruitAlias,
        isExcluded: classified.isExcluded,
        excludeReason: classified.excludeReason,
        isDuplicate,
      });
    }
  }

  return {
    headers,
    detectedMapping: mapping,
    totalRows: records.length,
    validRows,
    purchaseCount,
    excludedCount,
    duplicateCount,
    sampleRows,
  };
}

export interface CsvImportOptions {
  accountLabel: string;
  cardType: 'credit' | 'debit';
  mapping?: Partial<CsvColumnMapping>;
}

export async function importCsv(
  csvText: string,
  options: CsvImportOptions
): Promise<{
  addedCount: number;
  skippedDuplicates: number;
  excludedCount: number;
  accountId: string;
  affectedDates: string[];
}> {
  const { headers, records } = parseRecords(csvText);
  const auto = detectCsvMapping(headers, records);
  const mapping: CsvColumnMapping = {
    ...auto,
    ...options.mapping,
    signConvention:
      options.mapping?.signConvention && options.mapping.signConvention !== 'auto'
        ? options.mapping.signConvention
        : auto.signConvention,
  };

  const label = options.accountLabel.trim() || 'Uploaded Card CSV';
  const now = new Date().toISOString();

  const accountRow = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE name = ? AND source = 'csv'",
    [label]
  );

  let accountId: string;
  if (accountRow) {
    accountId = accountRow.id;
    await db.run('UPDATE accounts SET last_synced_at = ? WHERE id = ?', [now, accountId]);
  } else {
    accountId = `csv_${crypto.randomUUID().slice(0, 10)}`;
    await db.run(
      `INSERT INTO accounts (id, name, institution, mask, type, source, last_synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'csv', ?, ?)`,
      [accountId, label, 'CSV Statement', 'CSV', options.cardType, now, now]
    );
  }

  const insertSql = `
    INSERT INTO transactions (
      id, account_id, account_label, card_type, date, merchant, raw_description,
      amount, category, fruit_alias, source, external_id, dedupe_hash,
      is_excluded, exclude_reason, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv', NULL, ?, ?, ?, '', ?)
    ON CONFLICT (dedupe_hash) DO NOTHING
  `;

  const sourceKey = `csv:${label.toLowerCase()}`;
  let addedCount = 0;
  let skippedDuplicates = 0;
  let excludedCount = 0;
  const affectedDates = new Set<string>();

  for (const rec of records) {
    const date = normalizeDate(rec[mapping.dateCol] ?? '');
    const rawDescription = (rec[mapping.descriptionCol] ?? '').trim();
    const amount = extractAmount(rec, mapping);
    if (!date || !rawDescription || amount === null) continue;

    const roundedAmount = Math.round(amount * 100) / 100;
    const hash = makeDedupeHash(sourceKey, date, roundedAmount, rawDescription);
    const hintCat = mapping.categoryCol ? rec[mapping.categoryCol] : null;
    const classified = classifyTransaction(rawDescription, roundedAmount, hintCat);

    const res = await db.run(insertSql, [
      `tx_${crypto.randomUUID().slice(0, 12)}`,
      accountId,
      label,
      options.cardType,
      date,
      classified.merchant,
      rawDescription,
      roundedAmount,
      classified.category,
      classified.fruitAlias,
      hash,
      classified.isExcluded ? 1 : 0,
      classified.excludeReason,
      now,
    ]);

    if (res.changes > 0) {
      addedCount++;
      affectedDates.add(date);
      if (classified.isExcluded) excludedCount++;
    } else {
      skippedDuplicates++;
    }
  }

  await logSync(
    'csv',
    'success',
    addedCount,
    skippedDuplicates,
    `Imported ${addedCount} rows from "${label}" (${skippedDuplicates} duplicates skipped, ${excludedCount} transfers/payments filtered).`
  );

  return {
    addedCount,
    skippedDuplicates,
    excludedCount,
    accountId,
    affectedDates: Array.from(affectedDates).sort(),
  };
}

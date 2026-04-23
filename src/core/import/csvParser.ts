/**
 * csvParser — Phase 14.AB.2
 *
 * Minimal RFC 4180-compliant CSV parser. Zero dependencies.
 *
 * Covers what vendor price lists actually ship:
 *   • Quoted fields containing commas ("3/4", ...")
 *   • Quoted fields containing newlines
 *   • Escaped quotes ("" inside a quoted field)
 *   • CRLF or LF line endings
 *   • BOM on first cell (strip if present)
 *   • Trailing empty lines
 *
 * Does NOT support semicolon delimiters (European locale — add a
 * `delimiter` option later if a user actually hits it).
 *
 * Pure module. `parseCsv(text) → string[][]` — a 2D array of rows,
 * each row a list of cell strings. Callers interpret the first row
 * as headers if their schema expects it.
 */

export interface CsvParseOptions {
  /** Cell delimiter. Defaults to ','. */
  delimiter?: string;
  /** Trim leading/trailing whitespace from each cell. Default false. */
  trim?: boolean;
}

export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const delim = options.delimiter ?? ',';
  const trim = options.trim ?? false;

  // Strip UTF-8 BOM (U+FEFF) if present — Excel often prepends it.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  const pushCell = (): void => {
    row.push(trim ? cell.trim() : cell);
    cell = '';
  };
  const pushRow = (): void => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote "" or closing quote
        if (i + 1 < n && src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      pushCell();
      i++;
      continue;
    }
    if (ch === '\r') {
      // Eat \r\n as one newline
      if (i + 1 < n && src[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  // Flush the last row (if the file didn't end with a newline)
  if (cell.length > 0 || row.length > 0) {
    pushRow();
  }

  // Drop trailing empty rows (Excel often adds a final newline)
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '' || c.trim() === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * Convenience: split a CSV into { headers, rowsAsObjects }.
 * Uses the first row as column names. Case-sensitive.
 *
 * Useful for price-list mapping where the caller wants
 * `row['Price']` not `row[3]`.
 */
export interface CsvObjectResult {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvAsObjects(
  text: string,
  options: CsvParseOptions = {},
): CsvObjectResult {
  const rows = parseCsv(text, options);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0]!.map((h) => (options.trim === false ? h : h.trim()));
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const record: Record<string, string> = {};
    const src = rows[r]!;
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]!] = src[c] ?? '';
    }
    out.push(record);
  }
  return { headers, rows: out };
}

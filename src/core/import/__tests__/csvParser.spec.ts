/**
 * csvParser — Phase 14.AB.2 tests.
 *
 * Covers RFC 4180 edge cases that real vendor price lists ship with.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvAsObjects } from '../csvParser';

describe('parseCsv — happy paths', () => {
  it('simple 2×2 CSV', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('empty input → empty result', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('single cell', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('trailing newline OK', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('trailing blank rows stripped', () => {
    expect(parseCsv('a,b\n1,2\n\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCsv — quoting', () => {
  it('quoted field with comma', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('quoted field with escaped quote', () => {
    expect(parseCsv('"he said ""hi""",next')).toEqual([['he said "hi"', 'next']]);
  });

  it('quoted field with embedded newline', () => {
    expect(parseCsv('"line1\nline2",2')).toEqual([['line1\nline2', '2']]);
  });

  it('mixed quoted and unquoted', () => {
    expect(parseCsv('plain,"quoted",also_plain')).toEqual([
      ['plain', 'quoted', 'also_plain'],
    ]);
  });
});

describe('parseCsv — line endings', () => {
  it('CRLF', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('LF', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('mixed CRLF + LF', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
});

describe('parseCsv — BOM', () => {
  it('UTF-8 BOM stripped from first cell', () => {
    const csv = '\ufeffa,b\n1,2';
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCsv — options', () => {
  it('trim:true strips leading/trailing whitespace from cells', () => {
    expect(parseCsv('  a  ,  b  \n  1  ,  2  ', { trim: true })).toEqual([
      ['a', 'b'], ['1', '2'],
    ]);
  });

  it('custom delimiter', () => {
    expect(parseCsv('a;b\n1;2', { delimiter: ';' })).toEqual([
      ['a', 'b'], ['1', '2'],
    ]);
  });
});

describe('parseCsvAsObjects', () => {
  it('uses first row as headers', () => {
    const r = parseCsvAsObjects('Type,Size,Price\nelbow_90,2,5.00\nbend_45,3,12.00');
    expect(r.headers).toEqual(['Type', 'Size', 'Price']);
    expect(r.rows).toEqual([
      { Type: 'elbow_90', Size: '2', Price: '5.00' },
      { Type: 'bend_45', Size: '3', Price: '12.00' },
    ]);
  });

  it('missing cells default to empty string', () => {
    const r = parseCsvAsObjects('a,b,c\n1,2');
    expect(r.rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('empty CSV → empty', () => {
    expect(parseCsvAsObjects('')).toEqual({ headers: [], rows: [] });
  });

  it('realistic vendor CSV (Ferguson-style)', () => {
    const csv = [
      'Product Code,Description,Type,Size,Unit Price',
      'FE-90-2,"Elbow, 2"" schedule 40",elbow_90,2,5.85',
      'FE-TEE-3,"Tee, 3"" sanitary",sanitary_tee,3,22.15',
    ].join('\r\n');
    const r = parseCsvAsObjects(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!['Description']).toBe('Elbow, 2" schedule 40');
    expect(r.rows[0]!['Unit Price']).toBe('5.85');
  });
});

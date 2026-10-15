/** One CSV record and the 1-based line of the file where it starts. */
export type CsvRecord = { line: number; fields: string[] };

/**
 * Minimal RFC 4180 reader for the initial load (spec 0019, _Formato dos arquivos_): comma
 * separator, double-quoted fields with `""` as an escaped quote, CRLF or LF line breaks, and a
 * leading UTF-8 BOM ignored. Line breaks inside quotes stay in the field.
 *
 * Records whose fields are all blank are dropped, so trailing newlines and the empty rows a
 * spreadsheet exports do not become data; the others keep their line, which errors cite.
 */
export function parseCsv(text: string): CsvRecord[] {
    const source = text.startsWith('﻿') ? text.slice(1) : text;
    const records: CsvRecord[] = [];
    let fields: string[] = [];
    let field = '';
    let quoted = false;
    let line = 1;
    let recordLine = 1;
    let index = 0;

    const endField = (): void => {
        fields.push(field);
        field = '';
    };
    const endRecord = (): void => {
        endField();
        if (fields.some((value) => value.trim() !== '')) {
            records.push({ line: recordLine, fields });
        }
        fields = [];
    };

    while (index < source.length) {
        const char = source[index]!;

        if (quoted) {
            if (char === '"' && source[index + 1] === '"') {
                field += '"';
                index += 2;
                continue;
            }
            if (char === '"') {
                quoted = false;
            } else {
                if (char === '\n') {
                    line += 1;
                }
                field += char;
            }
            index += 1;
            continue;
        }

        if (char === '"') {
            quoted = true;
        } else if (char === ',') {
            endField();
        } else if (char === '\n' || char === '\r') {
            endRecord();
            if (char === '\r' && source[index + 1] === '\n') {
                index += 1;
            }
            line += 1;
            recordLine = line;
        } else {
            field += char;
        }
        index += 1;
    }

    if (field !== '' || fields.length > 0) {
        endRecord();
    }

    return records;
}

/**
 * Export to Excel (H7) — the original 16 columns in their original order, so
 * an exported file opens next to the old spreadsheet. Admin-only (the header
 * button is hidden for editors; the panel button sits in the admin tab).
 *
 * The reference keeps this in app.js and calls it from the admin backup tab
 * after closing the panel. What is exported is the workspace model's people —
 * soft-deleted people are not part of the model (restore views fetch them
 * separately), which matches the reference's own comment even better than its
 * code: an exported file is exactly the tree as shown.
 */
import type { I18n } from '../../core/i18n';
import type { TreeModel, Person } from '../tree/model';

/** The sheet name the importer expects back (round-trip). */
export const EXCEL_SHEET = 'Family_Data';

export interface ExportColumn {
  header: string;
  value: (p: Person) => string | number;
}

/* Generation is the depth computed by the model — what the UI displays. */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { header: 'Individual_ID', value: (p) => p.legacy_id ?? p.id },
  { header: 'Parent_ID', value: (p) => (p.parent?.legacy_id || p.parent?.id) ?? '' },
  { header: 'Generation', value: (p) => p.gen },
  { header: 'Gender', value: (p) => p.gender ?? '' },
  { header: 'Full_Name', value: (p) => p.name ?? '' },
  { header: 'Nick_Name', value: (p) => p.nick ?? '' },
  { header: 'Fathers_Name', value: (p) => p.father ?? '' },
  { header: 'Mothers_Name', value: (p) => p.mother ?? '' },
  { header: 'Spouse_Name', value: (p) => p.spouse ?? '' },
  { header: 'Spouse_Father_Name', value: (p) => p.spouseFather ?? '' },
  { header: 'DOB', value: (p) => p.dob_display ?? p.dob ?? '' },
  { header: 'Place_of_Birth', value: (p) => p.pob ?? '' },
  { header: 'Qualification', value: (p) => p.qual ?? '' },
  { header: 'Date_of_Death', value: (p) => p.dod_display ?? p.dod ?? '' },
  { header: 'Place_of_Burial', value: (p) => p.burial ?? '' },
  { header: 'Source_File', value: (p) => p.source ?? '' },
];

/** Sorted gen-first then by name, exactly like the reference's export. */
export function buildExportRows(people: readonly Person[]): Array<Record<string, string | number>> {
  const sorted = people
    .slice()
    .sort((a, b) => a.gen - b.gen || (a.name ?? '').localeCompare(b.name ?? ''));
  return sorted.map((p) => {
    const row: Record<string, string | number> = {};
    for (const column of EXPORT_COLUMNS) {
      row[column.header] = column.value(p);
    }
    return row;
  });
}

export interface ExcelExportDeps {
  i18n: I18n;
  getModel(): TreeModel;
  isAdmin(): boolean;
  toast(message: string): void;
}

/** One-stop exporter for the header button and the admin backup tab. */
export function exportTreeExcel(deps: ExcelExportDeps): void {
  if (!deps.isAdmin()) {
    deps.toast(deps.i18n.t('export.adminOnly'));
    return;
  }
  const rows = buildExportRows(deps.getModel().people);
  if (!rows.length) {
    deps.toast(deps.i18n.t('export.empty'));
    return;
  }
  void (async () => {
    try {
      const XLSX = await import('xlsx');
      const header = EXPORT_COLUMNS.map((c) => c.header);
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, EXCEL_SHEET);
      XLSX.writeFile(wb, `Nahri_Family_${new Date().toISOString().slice(0, 10)}.xlsx`);
      deps.toast(deps.i18n.fmt('export.done', { n: rows.length }));
    } catch (err) {
      // The file could not be built — never pretend it downloaded.
      console.warn('Export failed:', err);
      deps.toast(`${deps.i18n.t('export.noSheetJs')} (${err instanceof Error ? err.message : String(err)})`);
    }
  })();
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { Button } from './Button';
import { EmptyState, TableSkeleton } from './Feedback';
import { cn } from './cn';

export type { ColumnDef };

export interface DataTableProps<T> {
  data: T[] | undefined;
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  exportName?: string;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
  /** Initial sort, e.g. [{ id: 'at', desc: true }] for newest first (shows the sort arrow). */
  initialSort?: SortingState;
  /** Optional totals / summary bar shown under the rows, inside the table frame. */
  footer?: ReactNode;
  /** Draw the card surface around the table (default). Pass false when the table already sits inside a Card, so two rounded surfaces never nest. */
  frame?: boolean;
}

function toCsv<T>(rows: T[], cols: ColumnDef<T, unknown>[]) {
  const keyed = cols.filter((c) => 'accessorKey' in c && c.accessorKey) as (ColumnDef<T, unknown> & { accessorKey: string; header: unknown })[];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = keyed.map((c) => esc(typeof c.header === 'string' ? c.header : c.accessorKey)).join(',');
  const body = rows.map((r) => keyed.map((c) => esc((r as Record<string, unknown>)[c.accessorKey])).join(',')).join('\n');
  return `${head}\n${body}`;
}

// Cell layout (UI/UX audit): short values — IDs, codes, dates, amounts, statuses — never wrap mid-value; free-text columns
// wrap within a readable width; the row-action column (empty header or id 'a' / 'actions') stays pinned on the right.
type ColMeta = { align?: 'right' | 'center'; wrap?: boolean; nowrap?: boolean };
const PROSE = /client|name|description|reason|remark|justification|particular|location|incident|address|purpose|detail|message|comment|designation|subject|summary|entry|condition|service|notes?$|role|tag|title|item|vendor|supplier|payee|recipient|activity|outcome|issue|finding|basis/i;
const headerText = (c: { header?: unknown; id?: string }) => (typeof c.header === 'string' ? c.header : '');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isAction = (c: ColumnDef<any, any>) => { const id = (c as { id?: string }).id; return id === 'a' || id === 'actions' || id === 'act' || (!headerText(c as { header?: unknown }) && !!id && !('accessorKey' in c)); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isProse = (c: ColumnDef<any, any>) => { const m = c.meta as ColMeta | undefined; if (m?.nowrap) return false; if (m?.wrap) return true; return m?.align !== 'right' && PROSE.test(headerText(c as { header?: unknown })); };
// The action column is not pinned: tables are designed to fit the page (a pinned column covered data columns in the re-audit).
const STICKY_HEAD = 'w-px';
const STICKY_CELL = 'w-px';

/** Sticky header, sorting, client-side search + pagination, CSV export (docs/03 §6). Server pagination replaces this when the API is live. */
export function DataTable<T>({ data, columns, loading, searchable = true, searchPlaceholder = 'Search…', toolbar, emptyTitle = 'No records found', emptyHint, onRowClick, pageSize = 25, exportName, rowClassName, dense, initialSort, footer, frame = true }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const [globalFilter, setGlobalFilter] = useState('');
  const rows = useMemo(() => data ?? [], [data]);
  const table = useReactTable({
    data: rows, columns, state: { sorting, globalFilter }, onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } }, globalFilterFn: 'includesString',
  });

  const exportCsv = () => {
    const csv = toCsv(table.getFilteredRowModel().rows.map((r) => r.original), columns as ColumnDef<T, unknown>[]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${exportName}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const filtered = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  // Horizontal-scroll cue: soft edge shadows show that more columns exist off-screen.
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  // When the table is only a little wider than its card, tighten the cell padding so every column fits instead of showing a scroll cue.
  const [tight, setTight] = useState(false);
  useEffect(() => { const h = () => setTight(false); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  const measure = useCallback(() => {
    const el = scroller.current; if (!el) return;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 0 && over <= 120) setTight(true);
    // 12px tolerance: sub-pixel / border rounding must not show a "more columns" cue when everything fits.
    const next = { left: el.scrollLeft > 12, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 12 };
    setEdge((p) => (p.left === next.left && p.right === next.right ? p : next));
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    // Re-check once web fonts have loaded (column widths change slightly after the font swap).
    const t = window.setTimeout(measure, 600); document.fonts?.ready.then(measure).catch(() => undefined);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [measure, loading, filtered, pageIndex]);
  // Tightening changes column widths without resizing the scroller, so re-measure once the new padding is painted.
  useEffect(() => { const r = requestAnimationFrame(measure); return () => cancelAnimationFrame(r); }, [tight, measure]);

  return (
    <div className={cn(frame && 'overflow-hidden rounded-card bg-surface shadow-card')}>
      {(searchable || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-3 px-6 pb-3 pt-5">
          {searchable && (
            <div className="relative w-full shrink-0 sm:w-72">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input type="search" spellCheck={false} autoComplete="off" value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} aria-label="Search table"
                className="h-11 w-full rounded-full border border-line-strong bg-surface pl-10 pr-4 text-base text-ink placeholder:text-disabled transition-[border-color,box-shadow] duration-150 hover:border-ink/35 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12 sm:text-sm [&::-webkit-search-cancel-button]:hidden" />
            </div>
          )}
          {/* Form fields (Select / Input) share the row evenly (9–13rem each); segmented switches, buttons and date ranges keep their natural width. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 [&>[data-field]]:min-w-36 [&>[data-field]]:max-w-52 [&>[data-field]]:flex-1">{toolbar}</div>
          {exportName && <Button className="ml-auto shrink-0" variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv}>Export</Button>}
        </div>
      )}
      {loading ? <TableSkeleton /> : filtered === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : (
        <div className="relative">
        {edge.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-20 w-4 bg-gradient-to-r from-ink/10 to-transparent" />}
        {edge.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-20 w-6 bg-gradient-to-l from-ink/15 to-transparent" />}
        <div ref={scroller} onScroll={measure} className="overflow-x-auto">
          {/* Edge cells line up with the card's 24px padding; rows are separated by hairlines only. */}
          <table className="w-full border-collapse text-sm [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
            <thead className="sticky top-0 z-10 bg-surface">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    const meta = h.column.columnDef.meta as { align?: 'right' | 'center' } | undefined;
                    return (
                      <th key={h.id} scope="col" className={cn('whitespace-nowrap border-b border-line py-3', tight ? 'px-2' : 'px-3', 'text-left text-sm font-medium text-muted', meta?.align === 'right' && 'text-right', meta?.align === 'center' && 'text-center', isAction(h.column.columnDef) && STICKY_HEAD)}>
                        {h.isPlaceholder ? null : h.column.getCanSort() ? (
                          <button className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === 'asc' ? <ArrowUp className="size-3.5" /> : sorted === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-35" aria-hidden />}
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  className={cn('group border-b border-line transition-colors duration-150 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50/60', rowClassName?.(r.original))}>
                  {r.getVisibleCells().map((c) => {
                    const meta = c.column.columnDef.meta as { align?: 'right' | 'center' } | undefined;
                    const action = isAction(c.column.columnDef);
                    return <td key={c.id} className={cn('align-middle text-ink', tight ? 'px-2' : 'px-3', dense ? 'py-2' : 'py-3.5', isProse(c.column.columnDef) ? 'min-w-32 max-w-64 whitespace-normal' : 'whitespace-nowrap', meta?.align === 'right' && 'text-right tabular', meta?.align === 'center' && 'text-center', action && STICKY_CELL)}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
      {!loading && filtered > 0 && footer && <div className="overflow-x-auto border-t border-line bg-surface-alt px-6 py-3 text-sm font-medium text-ink">{footer}</div>}
      {!loading && filtered > pageSize && (
        <div className="flex items-center justify-between border-t border-line px-6 py-3 text-sm text-muted">
          <span className="tabular">{pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, filtered)} of {filtered}</span>
          <div className="flex gap-2">
            <Button variant="secondary" className="size-10 px-0" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} icon={<ChevronLeft className="size-4" />} />
            <Button variant="secondary" className="size-10 px-0" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} icon={<ChevronRight className="size-4" />} />
          </div>
        </div>
      )}
    </div>
  );
}

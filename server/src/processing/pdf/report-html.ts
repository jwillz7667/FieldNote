import { ApiSeverity } from '../../jobs/severity';

export interface ReportFindingView {
  text: string;
  severity: ApiSeverity;
}

export interface ReportSectionView {
  title: string;
  findings: ReportFindingView[];
}

export interface ReportView {
  jobId: string;
  label: string;
  /** Rendered into the report header; passed in so the builder stays pure. */
  generatedAt: Date;
  sections: ReportSectionView[];
}

interface SeverityStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

const SEVERITY_STYLES: Record<ApiSeverity, SeverityStyle> = {
  safety: { label: 'Safety', fg: '#7f1d1d', bg: '#fee2e2', border: '#fca5a5' },
  repair: { label: 'Repair', fg: '#7c2d12', bg: '#ffedd5', border: '#fdba74' },
  maintenance: { label: 'Maintenance', fg: '#713f12', bg: '#fef9c3', border: '#fde047' },
  info: { label: 'Info', fg: '#1e3a8a', bg: '#dbeafe', border: '#93c5fd' },
};

const SEVERITY_ORDER: ApiSeverity[] = ['safety', 'repair', 'maintenance', 'info'];

/**
 * Renders a self-contained, print-optimized HTML document for the report. No
 * external resources (fonts/images) are referenced so Puppeteer can render fully
 * offline and deterministically. All transcript-derived text is HTML-escaped to
 * keep the rendered document injection-safe (handoff §security).
 */
export function buildReportHtml(view: ReportView): string {
  const counts = countBySeverity(view.sections);
  const totalFindings = view.sections.reduce((n, s) => n + s.findings.length, 0);
  const generated = formatDate(view.generatedAt);

  const summaryChips = SEVERITY_ORDER.filter((sev) => counts[sev] > 0)
    .map((sev) => {
      const s = SEVERITY_STYLES[sev];
      return `<span class="chip" style="color:${s.fg};background:${s.bg};border-color:${s.border}">${s.label}: ${counts[sev]}</span>`;
    })
    .join('');

  const sectionsHtml =
    view.sections.length === 0
      ? `<p class="empty">No findings were recorded for this inspection.</p>`
      : view.sections.map(renderSection).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(view.label)} — Inspection Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 40px 44px; }
  header.report-head {
    border-bottom: 3px solid #0f172a;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #2563eb; }
  h1 { font-size: 24px; margin: 6px 0 2px; line-height: 1.2; }
  .meta { color: #475569; font-size: 11px; margin-top: 4px; }
  .meta strong { color: #0f172a; }
  .summary { margin: 18px 0 28px; }
  .summary-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  section.report-section { margin-bottom: 22px; page-break-inside: avoid; }
  section.report-section > h2 {
    font-size: 15px;
    margin: 0 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
  }
  ul.findings { list-style: none; margin: 0; padding: 0; }
  li.finding {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 9px 0;
    border-bottom: 1px solid #f1f5f9;
    page-break-inside: avoid;
  }
  li.finding:last-child { border-bottom: none; }
  .sev {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    min-width: 74px;
    text-align: center;
  }
  .finding-text { flex: 1 1 auto; }
  .empty { color: #64748b; font-style: italic; }
  footer.report-foot {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    color: #94a3b8;
    font-size: 10px;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="page">
    <header class="report-head">
      <div class="brand">FieldNote</div>
      <h1>${escapeHtml(view.label)}</h1>
      <div class="meta">Inspection Report &middot; Generated <strong>${escapeHtml(generated)}</strong> &middot; ${totalFindings} finding${totalFindings === 1 ? '' : 's'}</div>
    </header>

    <div class="summary">
      <div class="summary-title">Summary</div>
      <div class="chips">${summaryChips || '<span class="chip" style="color:#1e3a8a;background:#dbeafe;border-color:#93c5fd">No findings</span>'}</div>
    </div>

    ${sectionsHtml}

    <footer class="report-foot">
      <span>Generated by FieldNote</span>
      <span>Report ${escapeHtml(view.jobId)}</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderSection(section: ReportSectionView): string {
  const items = section.findings
    .map((f) => {
      const s = SEVERITY_STYLES[f.severity];
      return `      <li class="finding">
        <span class="sev" style="color:${s.fg};background:${s.bg};border-color:${s.border}">${s.label}</span>
        <span class="finding-text">${escapeHtml(f.text)}</span>
      </li>`;
    })
    .join('\n');

  return `    <section class="report-section">
      <h2>${escapeHtml(section.title)}</h2>
      <ul class="findings">
${items}
      </ul>
    </section>`;
}

function countBySeverity(sections: ReportSectionView[]): Record<ApiSeverity, number> {
  const counts: Record<ApiSeverity, number> = { safety: 0, repair: 0, maintenance: 0, info: 0 };
  for (const section of sections) {
    for (const finding of section.findings) {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

function formatDate(date: Date): string {
  // Stable, locale-independent rendering (e.g. "June 4, 2026 at 14:05 UTC").
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const m = months[date.getUTCMonth()];
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${m} ${d}, ${y} at ${hh}:${mm} UTC`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

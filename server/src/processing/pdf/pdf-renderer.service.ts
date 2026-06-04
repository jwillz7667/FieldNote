import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { buildReportHtml, ReportView } from './report-html';

/**
 * Renders a report view to a PDF buffer via headless Chromium (handoff §8 Stage 3).
 * One browser is launched lazily and reused across jobs; a fresh page per render
 * keeps jobs isolated. Hardened flags (--no-sandbox, --disable-dev-shm-usage) are
 * required to run Chromium as non-root inside the worker container.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  async render(view: ReportView): Promise<Buffer> {
    const html = buildReportHtml(view);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // The document is fully self-contained (no external fonts/images), so
      // 'load' fires once styles are parsed — no network idle wait needed.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      this.logger.log(`Rendered PDF for job ${view.jobId} (${pdf.length} bytes)`);
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }
    // Collapse concurrent first-render launches into a single browser instance.
    if (!this.launching) {
      this.launching = puppeteer
        .launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        })
        .then((browser) => {
          this.browser = browser;
          this.launching = null;
          return browser;
        })
        .catch((err) => {
          this.launching = null;
          throw err;
        });
    }
    return this.launching;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}

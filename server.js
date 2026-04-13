/**
 * Career-Ops Local Server
 * Handles: Playwright web scraping, PDF generation (HTML→PDF), Anthropic API proxy (bypasses CORS)
 * Run: node server.js
 */

import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3747;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname)); // serve index.html

// ─── Anthropic API proxy (avoids CORS issues in browser) ────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

  const body = JSON.stringify(req.body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const isStream = req.body.stream === true;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  const proxyReq = https.request(options, (proxyRes) => {
    if (isStream) {
      proxyRes.pipe(res);
    } else {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try { res.json(JSON.parse(data)); } catch { res.status(500).send(data); }
      });
    }
  });

  proxyReq.on('error', (e) => res.status(500).json({ error: e.message }));
  proxyReq.write(body);
  proxyReq.end();
});

// ─── Scrape a job page with Playwright ──────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait a moment for JS-rendered content
    await page.waitForTimeout(2000);

    // Try to detect if offer is still active
    const snapshot = await page.content();
    const bodyText = await page.evaluate(() => document.body.innerText);

    // Heuristic: if body is very short or has "job not found" patterns, mark closed
    const closedPatterns = [
      /job.*no longer.*available/i,
      /position.*filled/i,
      /posting.*expired/i,
      /job.*closed/i,
      /this job.*not.*found/i,
    ];
    const isClosed = bodyText.length < 400 || closedPatterns.some(p => p.test(bodyText));

    // Extract meaningful job content
    // Try common job-content selectors first, fall back to full body
    const jobText = await page.evaluate(() => {
      const selectors = [
        '[data-testid="job-description"]',
        '.job-description',
        '#job-description',
        '.posting-description',
        '[class*="jobDescription"]',
        '[class*="job_description"]',
        'article',
        'main',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.length > 300) return el.innerText;
      }
      return document.body.innerText;
    });

    // Extract job title if possible
    const title = await page.title();

    await browser.close();
    res.json({
      url,
      title,
      content: jobText.slice(0, 8000), // cap to avoid huge prompts
      isClosed,
      status: isClosed ? 'closed' : 'active',
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// ─── Scan job portals ────────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { portals } = req.body; // array of { name, url, selector? }
  if (!portals || !portals.length) return res.status(400).json({ error: 'portals array required' });

  let browser;
  const results = [];

  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    for (const portal of portals) {
      try {
        const page = await ctx.newPage();
        await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);

        const jobs = await page.evaluate((portalName) => {
          // Try to find job listings with common patterns
          const linkPatterns = [
            'a[href*="/jobs/"]',
            'a[href*="/careers/"]',
            'a[href*="/role/"]',
            'a[href*="/opening/"]',
            'a[href*="/position/"]',
            '[data-testid*="job"] a',
            '.job-listing a',
            '.posting a',
            'li a',
          ];

          const seen = new Set();
          const found = [];

          for (const sel of linkPatterns) {
            document.querySelectorAll(sel).forEach(a => {
              const href = a.href;
              const text = a.innerText.trim();
              if (text.length > 5 && text.length < 200 && !seen.has(href) && href.startsWith('http')) {
                seen.add(href);
                found.push({ title: text, url: href, company: portalName });
              }
            });
          }
          return found.slice(0, 30); // cap per portal
        }, portal.name);

        results.push({ portal: portal.name, url: portal.url, jobs, error: null });
        await page.close();
      } catch (e) {
        results.push({ portal: portal.name, url: portal.url, jobs: [], error: e.message });
      }
    }

    await browser.close();
    res.json({ results });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// ─── Generate PDF from HTML (CV) ─────────────────────────────────────────────
app.post('/api/pdf', async (req, res) => {
  const { html, filename } = req.body;
  if (!html) return res.status(400).json({ error: 'html required' });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle' });

    // Inject Google Fonts locally via CDN (Playwright can load external resources)
    await page.addStyleTag({
      content: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      `
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
      printBackground: true,
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'cv.pdf'}"`);
    res.send(pdfBuffer);
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, version: '1.0.0' }));

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Career-Ops server running at http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT} in your browser\n`);
});

#!/usr/bin/env node
// capture.js — Headless screenshot capture using Playwright
//
// Usage: node capture.js <url> <output-path> [viewport-width] [viewport-height]
// Exit code 0 = success, 1 = failure (error on stderr)

const { chromium } = require('playwright');
const path = require('path');

const [,, url, outputPath, viewportWidth, viewportHeight] = process.argv;

if (!url || !outputPath) {
    console.error('Usage: node capture.js <url> <output-path> [width] [height]');
    process.exit(1);
}

const width = parseInt(viewportWidth) || 1280;
const height = parseInt(viewportHeight) || 720;

(async () => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 2,  // Retina-quality screenshots
        });
        const page = await context.newPage();

        // Navigate with timeout
        await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: 30000,
        });

        // Small extra wait for any late-loading content
        await page.waitForTimeout(1000);

        // Take screenshot
        await page.screenshot({
            path: path.resolve(outputPath),
            fullPage: false,  // viewport only by default
        });

        console.log(JSON.stringify({
            success: true,
            url,
            file: outputPath,
            dimensions: `${width}x${height}`,
        }));

        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error(err.message);
        if (browser) await browser.close();
        process.exit(1);
    }
})();

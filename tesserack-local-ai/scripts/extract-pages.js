#!/usr/bin/env node
/**
 * Extract walkthrough pages from Prima Guide PDF as images
 *
 * Usage: node scripts/extract-pages.js [--start N] [--end N]
 *
 * Requires: pdf-poppler (npm install pdf-poppler)
 * Input: data/prima-guide.pdf
 * Output: data/prima-pages/page-XXX.png
 *
 * Walkthrough section is pages 7-61 (55 pages)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PDF_PATH = path.join(DATA_DIR, 'prima-guide.pdf');
const OUTPUT_DIR = path.join(DATA_DIR, 'prima-pages');

// Walkthrough section page range
const DEFAULT_START_PAGE = 7;
const DEFAULT_END_PAGE = 61;

// Parse command line args
function parseArgs() {
    const args = process.argv.slice(2);
    let startPage = DEFAULT_START_PAGE;
    let endPage = DEFAULT_END_PAGE;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--start' && args[i + 1]) {
            startPage = parseInt(args[i + 1], 10);
        }
        if (args[i] === '--end' && args[i + 1]) {
            endPage = parseInt(args[i + 1], 10);
        }
    }

    return { startPage, endPage };
}

/**
 * Check if pdftoppm is available (from poppler-utils)
 */
async function checkPdftoppm() {
    try {
        await execAsync('which pdftoppm');
        return true;
    } catch {
        return false;
    }
}

/**
 * Extract a single page using pdftoppm
 */
async function extractPage(pdfPath, pageNum, outputPath) {
    // pdftoppm uses -f and -l for first/last page
    // Output format: -png for PNG output
    // -r for resolution (DPI)
    const baseName = outputPath.replace('.png', '');

    const cmd = `pdftoppm -png -r 150 -f ${pageNum} -l ${pageNum} "${pdfPath}" "${baseName}"`;

    try {
        await execAsync(cmd);

        // pdftoppm adds page number suffix, rename to our format
        const generatedFile = `${baseName}-${pageNum}.png`;
        if (fs.existsSync(generatedFile)) {
            fs.renameSync(generatedFile, outputPath);
        } else {
            // Sometimes it pads the number
            const paddedFile = `${baseName}-${String(pageNum).padStart(2, '0')}.png`;
            if (fs.existsSync(paddedFile)) {
                fs.renameSync(paddedFile, outputPath);
            } else {
                // Try with more padding
                const morePaddedFile = `${baseName}-${String(pageNum).padStart(3, '0')}.png`;
                if (fs.existsSync(morePaddedFile)) {
                    fs.renameSync(morePaddedFile, outputPath);
                }
            }
        }

        return true;
    } catch (error) {
        console.error(`  Error extracting page ${pageNum}:`, error.message);
        return false;
    }
}

/**
 * Alternative: Use ImageMagick's convert if pdftoppm not available
 */
async function extractPageImageMagick(pdfPath, pageNum, outputPath) {
    // ImageMagick uses 0-based page indexing
    const cmd = `convert -density 150 "${pdfPath}[${pageNum - 1}]" "${outputPath}"`;

    try {
        await execAsync(cmd);
        return true;
    } catch (error) {
        console.error(`  Error extracting page ${pageNum}:`, error.message);
        return false;
    }
}

async function main() {
    console.log('=== Prima Guide Page Extractor ===\n');

    const { startPage, endPage } = parseArgs();
    console.log(`Extracting pages ${startPage}-${endPage} (${endPage - startPage + 1} pages)\n`);

    // Check PDF exists
    if (!fs.existsSync(PDF_PATH)) {
        console.error(`Error: PDF not found at ${PDF_PATH}`);
        console.error('Run `node scripts/download-prima-guide.js` first.');
        process.exit(1);
    }

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Check for pdftoppm
    const hasPdftoppm = await checkPdftoppm();

    if (!hasPdftoppm) {
        console.log('pdftoppm not found. Checking for ImageMagick...');
        try {
            await execAsync('which convert');
            console.log('Using ImageMagick (slower but works)\n');
        } catch {
            console.error('\nError: Neither pdftoppm nor ImageMagick found.');
            console.error('\nInstall poppler-utils:');
            console.error('  macOS:  brew install poppler');
            console.error('  Ubuntu: sudo apt-get install poppler-utils');
            console.error('  Or install ImageMagick as fallback.');
            process.exit(1);
        }
    } else {
        console.log('Using pdftoppm for extraction\n');
    }

    // Extract pages
    let extracted = 0;
    let skipped = 0;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        const paddedNum = String(pageNum).padStart(3, '0');
        const outputPath = path.join(OUTPUT_DIR, `page-${paddedNum}.png`);

        // Skip if already extracted
        if (fs.existsSync(outputPath)) {
            process.stdout.write(`\rPage ${pageNum}: already exists (skipping)`);
            skipped++;
            continue;
        }

        process.stdout.write(`\rExtracting page ${pageNum}/${endPage}...`);

        const success = hasPdftoppm
            ? await extractPage(PDF_PATH, pageNum, outputPath)
            : await extractPageImageMagick(PDF_PATH, pageNum, outputPath);

        if (success && fs.existsSync(outputPath)) {
            extracted++;
        }
    }

    console.log('\n');
    console.log(`Extracted: ${extracted} pages`);
    console.log(`Skipped: ${skipped} pages (already existed)`);
    console.log(`Output: ${OUTPUT_DIR}`);

    // List files
    const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
    console.log(`\nTotal PNG files: ${files.length}`);
}

main().catch(console.error);

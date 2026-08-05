#!/usr/bin/env node
/**
 * Download Prima Pokemon Red/Blue Strategy Guide from archive.org
 *
 * Usage: node scripts/download-prima-guide.js
 *
 * Output: data/prima-guide.pdf
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'prima-guide.pdf');

// Archive.org PDF URL (filename has spaces and parentheses)
const PDF_URL = 'https://archive.org/download/prima1999pokemonredblue/%28Prima%201999%29%20-%20Pokemon%20Red%20%26%20Blue.pdf';

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading from: ${url}`);
        console.log(`Saving to: ${dest}`);

        const file = fs.createWriteStream(dest);
        let downloadedBytes = 0;
        let totalBytes = 0;

        const makeRequest = (requestUrl) => {
            const protocol = requestUrl.startsWith('https') ? https : http;

            protocol.get(requestUrl, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.log(`Redirecting to: ${response.headers.location}`);
                    makeRequest(response.headers.location);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                    return;
                }

                totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                console.log(`File size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                        process.stdout.write(`\rProgress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    console.log('\nDownload complete!');
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => {}); // Delete partial file
                reject(err);
            });
        };

        makeRequest(url);
    });
}

async function main() {
    console.log('=== Prima Strategy Guide Downloader ===\n');

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Check if already downloaded
    if (fs.existsSync(OUTPUT_PATH)) {
        const stats = fs.statSync(OUTPUT_PATH);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        console.log(`File already exists: ${OUTPUT_PATH} (${sizeMB} MB)`);
        console.log('Delete the file to re-download.');
        return;
    }

    try {
        await downloadFile(PDF_URL, OUTPUT_PATH);

        // Verify file size (should be ~91MB)
        const stats = fs.statSync(OUTPUT_PATH);
        const sizeMB = stats.size / 1024 / 1024;

        if (sizeMB < 50) {
            console.warn(`\nWarning: File seems too small (${sizeMB.toFixed(1)} MB). Expected ~91 MB.`);
            console.warn('The download may have failed or been truncated.');
        } else {
            console.log(`\nVerified: ${sizeMB.toFixed(1)} MB downloaded successfully.`);
        }
    } catch (error) {
        console.error('\nError downloading file:', error.message);
        process.exit(1);
    }
}

main();

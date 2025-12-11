/**
 * Download ONNX models from Hugging Face
 *
 * This script downloads the style embedding model during build on Render
 * since Git LFS is not available on their build machines.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS = [
  {
    name: 'Style-Embedding ONNX model',
    url: 'https://github.com/jwitchel/T2J/releases/download/v0.0.1-models/model.onnx',
    dest: path.join(__dirname, '../models/AnnaWegmann/Style-Embedding/onnx/model.onnx')
  }
];

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    // Create directory if it doesn't exist
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });

    // Check if file already exists and has content
    if (fs.existsSync(dest)) {
      const stats = fs.statSync(dest);
      if (stats.size > 1000000) { // > 1MB means it's likely the real file, not LFS pointer
        console.log(`  Already exists (${(stats.size / 1024 / 1024).toFixed(1)}MB), skipping`);
        resolve();
        return;
      }
    }

    const file = fs.createWriteStream(dest);
    let downloadedBytes = 0;
    let totalBytes = 0;

    const request = (url) => {
      https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        totalBytes = parseInt(response.headers['content-length'], 10) || 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r  Downloading: ${mb}MB (${percent}%)`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`\n  Complete: ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB`);
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete partial file
        reject(err);
      });
    };

    request(url);
  });
}

async function main() {
  console.log('Downloading models for production...\n');

  for (const model of MODELS) {
    console.log(`${model.name}:`);
    try {
      await downloadFile(model.url, model.dest);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\nAll models downloaded successfully!');
}

main();

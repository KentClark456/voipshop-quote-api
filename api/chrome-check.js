// api/chrome-check.js
import chromium from '@sparticuz/chromium';
import pptrCore from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

// Make sure the native libs are visible at runtime
process.env.LD_LIBRARY_PATH = `${process.env.LD_LIBRARY_PATH || ''}:/var/task/node_modules/@sparticuz/chromium/lib`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const libDir = '/var/task/node_modules/@sparticuz/chromium/lib';
  const libDirExists = fs.existsSync(libDir);
  const libnss3Exists = fs.existsSync(path.join(libDir, 'libnss3.so'));

  let exePath = null;
  let launchOk = false;
  let launchError = null;

  try {
    exePath = await chromium.executablePath();
  } catch (e) {
    exePath = `executablePath error: ${String(e?.message || e)}`;
  }

  try {
    const browser = await pptrCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
    await browser.close();
    launchOk = true;
  } catch (e) {
    launchError = String(e?.message || e);
  }

  res.status(200).json({
    node: process.version,
    region: process.env.VERCEL_REGION || null,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || null,
    libs: {
      libDir,
      libDirExists,
      libnss3Exists,
      sample: libDirExists ? fs.readdirSync(libDir).slice(0, 12) : []
    },
    chromium: { exePath },
    launch: { ok: launchOk, error: launchError }
  });
}

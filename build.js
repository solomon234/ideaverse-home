'use strict';
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

const install = process.argv.includes('--install');
const vault = process.env.VAULT; // path to your vault, needed only for --install

(async () => {
  await esbuild.build({
    entryPoints: ['src/main.js'], bundle: true, platform: 'node', format: 'cjs', target: 'es2020',
    outfile: 'dist/main.js', logLevel: 'info',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...require('module').builtinModules]
  });
  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  fs.copyFileSync('src/styles.css', 'dist/styles.css');
  if (install) {
    if (!vault) throw new Error('Set VAULT=/path/to/your/vault to install');
    const dest = path.join(vault, '.obsidian/plugins/ideaverse-home');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join('dist', f), path.join(dest, f));
    console.log('installed to', dest);
  }
})().catch(e => { console.error(e); process.exit(1); });

const { spawn } = require('child_process');
const path = require('path');

process.env.BASE_URL = 'http://127.0.0.1:5174';

console.log('Starting semantic verification audit...');
console.log('BASE_URL:', process.env.BASE_URL);
console.log('');

const playwright = spawn('cmd.exe', [
  '/c',
  'npx',
  'playwright',
  'test',
  'tests/e2e/audit-semantic-verification.spec.ts',
  '--reporter=list'
], {
  cwd: __dirname,
  env: { ...process.env },
  stdio: 'inherit',
  shell: true
});

playwright.on('close', (code) => {
  console.log('');
  console.log('Audit process exited with code:', code);
  process.exit(code);
});

playwright.on('error', (err) => {
  console.error('Failed to start audit:', err);
  process.exit(1);
});

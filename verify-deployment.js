#!/usr/bin/env node

/**
 * Pre-Deployment Verification Script
 * Run this before deploying to catch any issues
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Verifying eBay Market Pulse Deployment Readiness...\n');

const checks = [];
let errors = 0;
let warnings = 0;

// Helper functions
function checkFile(filePath, description) {
  const exists = fs.existsSync(filePath);
  checks.push({
    status: exists ? '✅' : '❌',
    message: description,
    path: filePath
  });
  if (!exists) errors++;
  return exists;
}

function checkPackageScript(packagePath, scriptName, description) {
  if (!fs.existsSync(packagePath)) {
    checks.push({ status: '❌', message: `${description} - package.json missing`, path: packagePath });
    errors++;
    return false;
  }
  
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const hasScript = pkg.scripts && pkg.scripts[scriptName];
  checks.push({
    status: hasScript ? '✅' : '❌',
    message: `${description} - "${scriptName}" script`,
    path: packagePath
  });
  if (!hasScript) errors++;
  return hasScript;
}

function checkDependency(packagePath, depName, description) {
  if (!fs.existsSync(packagePath)) return false;
  
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const hasDep = (pkg.dependencies && pkg.dependencies[depName]) || 
                 (pkg.devDependencies && pkg.devDependencies[depName]);
  
  checks.push({
    status: hasDep ? '✅' : '⚠️',
    message: `${description} - ${depName}`,
    path: packagePath
  });
  if (!hasDep) warnings++;
  return hasDep;
}

// Core Files
console.log('📦 Core Files:');
checkFile('./Dockerfile', 'Dockerfile (Railway build)');
checkFile('./railway.json', 'railway.json (Railway config)');
checkFile('./package.json', 'Root package.json');
checkFile('./README.md', 'README documentation');
checkFile('./DEPLOY_CHECKLIST.md', 'Deployment checklist');
checkFile('./ENV_SETUP_GUIDE.md', 'Environment setup guide');

// Server Files
console.log('\n🖥️  Server:');
checkFile('./server/index.js', 'Server entry point');
checkFile('./server/package.json', 'Server package.json');
checkPackageScript('./server/package.json', 'start', 'Server start script');
checkFile('./server/services/scraper.js', 'Scraper service');
checkFile('./server/services/identifier.js', 'Identifier service');

// Server Dependencies
checkDependency('./server/package.json', 'express', 'Express framework');
checkDependency('./server/package.json', 'sequelize', 'Sequelize ORM');
checkDependency('./server/package.json', 'pg', 'PostgreSQL driver');
checkDependency('./server/package.json', 'cors', 'CORS middleware');

// Client Files
console.log('\n🎨 Client:');
checkFile('./client/index.html', 'Client HTML');
checkFile('./client/package.json', 'Client package.json');
checkFile('./client/vite.config.js', 'Vite config');
checkFile('./client/src/App.jsx', 'React App component');
checkFile('./client/src/main.jsx', 'React entry point');
checkPackageScript('./client/package.json', 'build', 'Client build script');

// Pi Worker Files
console.log('\n🍓 Pi Worker:');
checkFile('./pi-worker/index.js', 'Worker entry point');
checkFile('./pi-worker/scraper.js', 'Worker scraper');
checkFile('./pi-worker/package.json', 'Worker package.json');
checkFile('./pi-worker/.env.example', 'Worker env example');

// Print Results
console.log('\n' + '='.repeat(60));
checks.forEach(check => {
  console.log(`${check.status} ${check.message}`);
});
console.log('='.repeat(60));

// Summary
console.log('\n📊 Summary:');
console.log(`   ✅ Passed: ${checks.filter(c => c.status === '✅').length}`);
if (warnings > 0) console.log(`   ⚠️  Warnings: ${warnings}`);
if (errors > 0) console.log(`   ❌ Errors: ${errors}`);

if (errors === 0) {
  console.log('\n🎉 All checks passed! Ready to deploy to Railway!\n');
  console.log('📝 Next Steps:');
  console.log('   1. Read: DEPLOY_CHECKLIST.md');
  console.log('   2. Deploy ebay-final folder to Railway');
  console.log('   3. Add PostgreSQL database in Railway');
  console.log('   4. Set environment variables (see ENV_SETUP_GUIDE.md)');
  console.log('   5. Configure Pi worker (see DEPLOY_CHECKLIST.md)\n');
  process.exit(0);
} else {
  console.log('\n❌ Some files are missing. Please check the errors above.\n');
  process.exit(1);
}


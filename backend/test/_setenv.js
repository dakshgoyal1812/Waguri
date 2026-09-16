// Side-effect module: must be the FIRST import in in-process unit tests so env is
// set before config.js captures it (ESM imports evaluate in order).
process.env.WAGURI_TEST = '1';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';

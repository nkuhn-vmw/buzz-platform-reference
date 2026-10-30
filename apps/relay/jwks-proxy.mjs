import { startJwksProxy } from './cf-mtls/proxy.mjs';
try {
  const proxy = await startJwksProxy({
    targetUrl: process.env.JWKS_MTLS_TARGET_URL,
    expectedAppGuid: process.env.JWKS_MTLS_IDENTITY_APP_GUID,
    port: 8082,
  });
  console.log('JWKS bridge ready on loopback; upstream requires mutual CF app identity.');
  const stop = async () => { await proxy.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'INITIALIZATION_FAILED';
  console.error(`JWKS bridge failed (${code}); refusing unauthenticated fallback.`);
  process.exitCode = 1;
}

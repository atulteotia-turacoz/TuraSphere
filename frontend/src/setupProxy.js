// Dev-server middleware.
//
// Makes ONLY the in-app meeting room cross-origin isolated (COOP + COEP) so the
// Zoom Web SDK can use SharedArrayBuffer — without it, the SDK's media engine
// never initializes and getMediaStream() returns null (mic/camera do nothing).
//
// Scoped to /meeting-room so the rest of the app (payments, external embeds,
// images) is unaffected. The meeting always opens in a NEW TAB, so that document
// loads fresh with these headers. COEP "credentialless" lets the Zoom CDN assets
// load without each needing a CORP header.
//
// PRODUCTION: replicate in nginx — set the same two headers on the SPA fallback
// for location ^~ /meeting-room only. See 02_FRONTEND_FILES.md (same date).
const ISOLATED = ['/meeting-room', '/meeting/join'];  // routes that embed the Zoom SDK

module.exports = function (app) {
  app.use((req, res, next) => {
    if (ISOLATED.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    }
    next();
  });
};

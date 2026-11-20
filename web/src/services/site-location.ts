export function isLiveSite(url: URL) {
  return (
    (url.origin === 'https://draftedge.website' && url.pathname === '/') ||
    (url.origin === 'https://pant4321.github.io' &&
      url.pathname === '/draft-lab/')
  );
}

export function canUseCompanion(url: URL) {
  return (
    isLiveSite(url) ||
    (url.protocol === 'http:' && url.hostname === '127.0.0.1')
  );
}

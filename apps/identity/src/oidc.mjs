import { fetchUserInfo } from 'openid-client';

const normalizeEmail = (email) => typeof email === 'string' ? email.trim().toLowerCase() : null;

export async function verifiedLoginEmail(config, tokenSet, getUserInfo = fetchUserInfo) {
  const claims = tokenSet.claims();
  if (!claims || claims.email_verified === false) return null;
  if (claims.email_verified === true && typeof claims.email === 'string') return claims.email;
  if (!tokenSet.access_token || typeof claims.sub !== 'string' || !claims.sub) return null;
  const userInfo = await getUserInfo(config, tokenSet.access_token, claims.sub);
  if (!userInfo || userInfo.sub !== claims.sub || userInfo.email_verified !== true || typeof userInfo.email !== 'string') return null;
  if (typeof claims.email === 'string' && normalizeEmail(claims.email) !== normalizeEmail(userInfo.email)) return null;
  return userInfo.email;
}

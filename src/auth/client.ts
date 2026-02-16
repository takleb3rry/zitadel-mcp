/**
 * Zitadel Management API Client
 * JWT bearer token authentication via service account
 *
 * Ported from app-portal's Zitadel client with class-based config injection
 */

import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'crypto';
import type { ZitadelConfig } from '../utils/config.js';
import type { ZitadelError } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

export class ZitadelClient {
  private config: ZitadelConfig;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: ZitadelConfig) {
    this.config = config;
  }

  getConfig(): ZitadelConfig {
    return this.config;
  }

  clearTokenCache(): void {
    this.cachedToken = null;
  }

  /**
   * Generate a JWT assertion for the service account
   * Zitadel provides keys in PKCS#1 format; jose expects PKCS#8
   */
  private async generateJwtAssertion(): Promise<string> {
    const { serviceAccountUserId, serviceAccountKeyId, serviceAccountPrivateKey, issuer } = this.config;

    // Decode the base64-encoded private key
    let privateKeyPem: string;
    try {
      privateKeyPem = Buffer.from(serviceAccountPrivateKey, 'base64').toString('utf-8');
    } catch {
      privateKeyPem = serviceAccountPrivateKey;
    }

    // Convert PKCS#1 to PKCS#8 if needed
    let pkcs8Pem: string;
    if (privateKeyPem.includes('BEGIN RSA PRIVATE KEY')) {
      const keyObject = createPrivateKey(privateKeyPem);
      pkcs8Pem = keyObject.export({ type: 'pkcs8', format: 'pem' }) as string;
    } else {
      pkcs8Pem = privateKeyPem;
    }

    const privateKey = await importPKCS8(pkcs8Pem, 'RS256');
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: serviceAccountKeyId })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setIssuer(serviceAccountUserId)
      .setSubject(serviceAccountUserId)
      .setAudience(issuer)
      .sign(privateKey);
  }

  /**
   * Exchange JWT assertion for an access token (cached for ~1 hour)
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s safety buffer)
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60000) {
      return this.cachedToken.token;
    }

    const jwtAssertion = await this.generateJwtAssertion();
    const tokenUrl = `${this.config.issuer}/oauth/v2/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtAssertion,
        scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in?: number };

    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    return data.access_token;
  }

  /**
   * Make an authenticated request to the Zitadel Management API
   * Includes x-zitadel-orgid header, handles 401 cache clearing and empty responses
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.config.issuer}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-zitadel-orgid': this.config.orgId,
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      let errorData: ZitadelError | null = null;
      try {
        errorData = await response.json() as ZitadelError;
      } catch {
        // Ignore JSON parse errors
      }

      const errorMessage = errorData?.message || `HTTP ${response.status}`;
      logger.error('Zitadel API error', { status: response.status, path, error: errorData });

      // Clear token cache on auth failures
      if (response.status === 401) {
        this.clearTokenCache();
      }

      throw new Error(`Zitadel API error: ${errorMessage}`);
    }

    // Handle empty responses (e.g. DELETE operations)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }
}

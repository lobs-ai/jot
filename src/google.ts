import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import http from 'http';
import { spawn } from 'child_process';

const GOOGLE_AUTH_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const DEFAULT_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, 'openid', 'email', 'profile'];

export interface GoogleOAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

export interface GoogleCredentialsFile {
  installed?: GoogleOAuthClientConfig;
  web?: GoogleOAuthClientConfig;
}

export interface GoogleTokenData {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export interface GoogleConfig {
  gmail_enabled: boolean;
  calendar_enabled: boolean;
  credentials_path: string;
  tokens_path: string;
}

export interface GmailEmail {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
}

function getJotDir(): string {
  return path.join(os.homedir(), '.jot');
}

function getCredentialsDir(): string {
  return path.join(getJotDir(), 'credentials');
}

function getGoogleConfigPath(): string {
  return path.join(getJotDir(), 'google-config.json');
}

function getDefaultGoogleConfig(): GoogleConfig {
  return {
    gmail_enabled: false,
    calendar_enabled: false,
    credentials_path: path.join(getCredentialsDir(), 'google-oauth-client.json'),
    tokens_path: path.join(getCredentialsDir(), 'google-token.json')
  };
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getOAuthClientConfig(credentials: GoogleCredentialsFile): GoogleOAuthClientConfig {
  const client = credentials.installed || credentials.web;
  if (!client?.client_id || !client.client_secret) {
    throw new Error('Invalid Google OAuth client file. Expected an installed or web OAuth client JSON.');
  }
  return client;
}

function parseGoogleCredentials(raw: string): GoogleCredentialsFile {
  const parsed = JSON.parse(raw) as GoogleCredentialsFile;
  getOAuthClientConfig(parsed);
  return parsed;
}

function openUrl(url: string): void {
  try {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // Fallback is to print the URL for manual use.
  }
}

async function createOAuthServer(expectedState: string): Promise<{
  redirectUri: string;
  codePromise: Promise<string>;
}> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let codeResolve: ((code: string) => void) | null = null;
    let codeReject: ((error: Error) => void) | null = null;
    const codePromise = new Promise<string>((innerResolve, innerReject) => {
      codeResolve = innerResolve;
      codeReject = innerReject;
    });

    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const code = requestUrl.searchParams.get('code');
        const error = requestUrl.searchParams.get('error');
        const returnedState = requestUrl.searchParams.get('state');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Google OAuth failed: ${error}`);
          server.close();
          codeReject?.(new Error(`Google OAuth failed: ${error}`));
          return;
        }

        if (returnedState !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('State mismatch during Google OAuth.');
          server.close();
          codeReject?.(new Error('Google OAuth state mismatch.'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Missing OAuth code.');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Google authentication complete. You can close this tab and return to Jot.');
        server.close();
        codeResolve?.(code);
      } catch (error) {
        server.close();
        codeReject?.(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        redirectUri: `http://127.0.0.1:${port}`,
        codePromise
      });
    });
  });
}

async function exchangeAuthorizationCode(
  client: GoogleOAuthClientConfig,
  code: string,
  redirectUri: string
): Promise<GoogleTokenData> {
  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${String(data.error_description || data.error || response.status)}`);
  }

  return {
    access_token: String(data.access_token || ''),
    refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
    scope: data.scope ? String(data.scope) : undefined,
    token_type: data.token_type ? String(data.token_type) : undefined,
    expiry_date: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined
  };
}

async function refreshAccessToken(client: GoogleOAuthClientConfig, token: GoogleTokenData): Promise<GoogleTokenData> {
  if (!token.refresh_token) {
    throw new Error('Google refresh token not found. Run: jot google auth');
  }

  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token'
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${String(data.error_description || data.error || response.status)}`);
  }

  return {
    access_token: String(data.access_token || ''),
    refresh_token: token.refresh_token,
    scope: data.scope ? String(data.scope) : token.scope,
    token_type: data.token_type ? String(data.token_type) : token.token_type,
    expiry_date: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : token.expiry_date
  };
}

async function googleApiGet<T>(url: string): Promise<T> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google API request failed (${response.status}): ${body}`);
  }

  return await response.json() as T;
}

export function getGoogleConfig(): GoogleConfig {
  const defaults = getDefaultGoogleConfig();
  const configPath = getGoogleConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<GoogleConfig>;
    return {
      gmail_enabled: parsed.gmail_enabled ?? defaults.gmail_enabled,
      calendar_enabled: parsed.calendar_enabled ?? defaults.calendar_enabled,
      credentials_path: parsed.credentials_path || defaults.credentials_path,
      tokens_path: parsed.tokens_path || defaults.tokens_path
    };
  } catch {
    return defaults;
  }
}

export function saveGoogleConfig(config: GoogleConfig): void {
  const configPath = getGoogleConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function loadGoogleCredentials(): GoogleCredentialsFile | null {
  const config = getGoogleConfig();
  if (!fs.existsSync(config.credentials_path)) {
    return null;
  }

  try {
    return parseGoogleCredentials(fs.readFileSync(config.credentials_path, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadGoogleTokens(): GoogleTokenData | null {
  const config = getGoogleConfig();
  if (!fs.existsSync(config.tokens_path)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(config.tokens_path, 'utf-8')) as GoogleTokenData;
  } catch {
    return null;
  }
}

export function saveGoogleTokens(token: GoogleTokenData): void {
  const config = getGoogleConfig();
  ensureDir(path.dirname(config.tokens_path));
  fs.writeFileSync(config.tokens_path, JSON.stringify(token, null, 2));
}

export function hasGoogleCredentials(): boolean {
  return loadGoogleCredentials() !== null;
}

export function hasGoogleTokens(): boolean {
  return loadGoogleTokens() !== null;
}

export function setupGoogleCredentials(credentialsPath?: string): void {
  const config = getGoogleConfig();
  const targetPath = config.credentials_path;
  ensureDir(path.dirname(targetPath));

  if (!credentialsPath) {
    console.log(`Expected Google OAuth client file at: ${targetPath}`);
    console.log('Run: jot google setup <path-to-oauth-client.json>');
    return;
  }

  const raw = fs.readFileSync(credentialsPath, 'utf-8');
  parseGoogleCredentials(raw);
  fs.writeFileSync(targetPath, raw);

  console.log(`Google OAuth client saved to ${targetPath}`);
  console.log('Next step: run `jot google auth` to complete the OAuth flow.');
}

export async function authenticateGoogle(scopes: string[] = DEFAULT_SCOPES): Promise<void> {
  const credentials = loadGoogleCredentials();
  if (!credentials) {
    throw new Error('Google credentials not found. Run: jot google setup <path-to-oauth-client.json>');
  }

  const client = getOAuthClientConfig(credentials);
  const state = crypto.randomUUID();
  const { redirectUri, codePromise } = await createOAuthServer(state);

  const authUrl = new URL(GOOGLE_AUTH_BASE_URL);
  authUrl.searchParams.set('client_id', client.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  console.log('Opening Google OAuth consent in your browser...');
  console.log(authUrl.toString());
  openUrl(authUrl.toString());

  const code = await codePromise;
  const token = await exchangeAuthorizationCode(client, code, redirectUri);
  saveGoogleTokens(token);
  console.log('Google OAuth complete. Tokens saved.');
}

export async function getGoogleAccessToken(): Promise<string> {
  const credentials = loadGoogleCredentials();
  if (!credentials) {
    throw new Error('Google credentials not found. Run: jot google setup <path-to-oauth-client.json>');
  }

  const token = loadGoogleTokens();
  if (!token) {
    throw new Error('Google OAuth tokens not found. Run: jot google auth');
  }

  if (token.access_token && token.expiry_date && token.expiry_date > Date.now() + 60000) {
    return token.access_token;
  }

  const refreshed = await refreshAccessToken(getOAuthClientConfig(credentials), token);
  saveGoogleTokens(refreshed);
  return refreshed.access_token;
}

export function enableGoogleService(service: 'gmail' | 'calendar', enabled: boolean): void {
  const config = getGoogleConfig();
  if (service === 'gmail') {
    config.gmail_enabled = enabled;
  } else {
    config.calendar_enabled = enabled;
  }
  saveGoogleConfig(config);
  console.log(`${service} ${enabled ? 'enabled' : 'disabled'}`);
}

export async function fetchGmailEmails(days: number = 3): Promise<GmailEmail[]> {
  const config = getGoogleConfig();
  if (!config.gmail_enabled) {
    console.log('Gmail not enabled. Run: jot google gmail --enable');
    return [];
  }

  if (!loadGoogleCredentials()) {
    console.log('Google credentials not found. Run: jot google setup <path-to-oauth-client.json>');
    return [];
  }

  if (!loadGoogleTokens()) {
    console.log('Google OAuth tokens not found. Run: jot google auth');
    return [];
  }

  const query = encodeURIComponent(`newer_than:${Math.max(1, days)}d`);
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${query}`;
  const messageList = await googleApiGet<{ messages?: Array<{ id: string; threadId?: string }> }>(listUrl);
  const messages = messageList.messages || [];

  const results = await Promise.all(messages.map(async (message) => {
    const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
    const detail = await googleApiGet<{
      id: string;
      threadId?: string;
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    }>(detailUrl);

    const headers = detail.payload?.headers || [];
    const header = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    return {
      id: detail.id,
      threadId: detail.threadId,
      subject: header('Subject') || '(no subject)',
      from: header('From') || '(unknown sender)',
      date: header('Date') || '',
      snippet: detail.snippet || ''
    };
  }));

  return results;
}

export async function fetchCalendarEvents(weeks: number = 1): Promise<CalendarEvent[]> {
  const config = getGoogleConfig();
  if (!config.calendar_enabled) {
    console.log('Calendar not enabled. Run: jot google calendar --enable');
    return [];
  }

  if (!loadGoogleCredentials()) {
    console.log('Google credentials not found. Run: jot google setup <path-to-oauth-client.json>');
    return [];
  }

  if (!loadGoogleTokens()) {
    console.log('Google OAuth tokens not found. Run: jot google auth');
    return [];
  }

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + Math.max(1, weeks) * 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '25');

  const data = await googleApiGet<{
    items?: Array<{
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string }>;
    }>;
  }>(url.toString());

  return (data.items || []).map(item => ({
    id: item.id,
    summary: item.summary || '(untitled event)',
    start: item.start?.dateTime || item.start?.date || '',
    end: item.end?.dateTime || item.end?.date || '',
    attendees: item.attendees?.map(attendee => attendee.email || '').filter(Boolean),
    location: item.location
  }));
}

export function getGoogleStatus(): {
  config: GoogleConfig;
  hasCredentials: boolean;
  hasTokens: boolean;
} {
  return {
    config: getGoogleConfig(),
    hasCredentials: hasGoogleCredentials(),
    hasTokens: hasGoogleTokens()
  };
}

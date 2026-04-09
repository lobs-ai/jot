import fs from 'fs';
import path from 'path';
import os from 'os';

export type ApiType = 'openai' | 'ollama';

export interface BackendConfig {
  url: string;
  model: string;
  enabled: boolean;
  apiType?: ApiType;
}

export interface RemoteConfig {
  enabled: boolean;
  url: string;
  apiKey?: string;
}

export interface AnalysisConfig {
  extractActionItems: boolean;
  linkRelatedNotes: boolean;
  autoAnalyze: boolean;
}

export interface UserProfile {
  name?: string;
  bio?: string;
  timezone?: string;
}

export interface Config {
  backends: {
    lmstudio?: BackendConfig;
    ollama?: BackendConfig;
  };
  defaultBackend: 'lmstudio' | 'ollama';
  remote: RemoteConfig;
  analysis: AnalysisConfig;
  notifier?: 'discord' | 'terminal' | 'webhook' | 'none';
  discordWebhook?: string;
  deliveryMode?: 'urgent' | 'digest' | 'always';
  digestTime?: string;
  processInterval?: number;
  userFile?: string;
  profile?: UserProfile;
}

function normalizeBackendUrl(url: string, apiType: ApiType): string {
  if (apiType === 'ollama' && url.endsWith('/v1/chat/completions')) {
    return url.replace(/\/v1\/chat\/completions$/, '/api/chat');
  }

  if (apiType === 'openai' && url.endsWith('/api/chat')) {
    return url.replace(/\/api\/chat$/, '/v1/chat/completions');
  }

  return url;
}

const DEFAULT_CONFIG: Config = {
  backends: {
    lmstudio: {
      url: 'http://127.0.0.1:1234/v1/chat/completions',
      model: 'qwen2.5-7b-instruct',
      enabled: true,
      apiType: 'openai'
    },
    ollama: {
      url: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'llama3.2',
      enabled: false,
      apiType: 'ollama'
    }
  },
  defaultBackend: 'lmstudio',
  remote: {
    enabled: false,
    url: ''
  },
  analysis: {
    extractActionItems: true,
    linkRelatedNotes: true,
    autoAnalyze: true
  },
  notifier: 'none',
  discordWebhook: '',
  deliveryMode: 'urgent',
  digestTime: '08:00',
  processInterval: 300,
  userFile: '~/.jot/user.md',
  profile: {
    name: '',
    bio: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  }
};

export function getConfigPath(): string {
  return path.join(os.homedir(), '.jot', 'config.json');
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(raw);
    return {
      backends: {
        lmstudio: { ...DEFAULT_CONFIG.backends.lmstudio, ...userConfig.backends?.lmstudio },
        ollama: { ...DEFAULT_CONFIG.backends.ollama, ...userConfig.backends?.ollama }
      },
      defaultBackend: userConfig.defaultBackend || DEFAULT_CONFIG.defaultBackend,
      remote: { ...DEFAULT_CONFIG.remote, ...userConfig.remote },
      analysis: { ...DEFAULT_CONFIG.analysis, ...userConfig.analysis },
      notifier: userConfig.notifier || DEFAULT_CONFIG.notifier,
      discordWebhook: userConfig.discordWebhook || DEFAULT_CONFIG.discordWebhook,
      deliveryMode: userConfig.deliveryMode || DEFAULT_CONFIG.deliveryMode,
      digestTime: userConfig.digestTime || DEFAULT_CONFIG.digestTime,
      processInterval: userConfig.processInterval || DEFAULT_CONFIG.processInterval,
      userFile: userConfig.userFile || DEFAULT_CONFIG.userFile,
      profile: { ...DEFAULT_CONFIG.profile, ...userConfig.profile }
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getActiveBackend(): { url: string; model: string; apiType: ApiType } {
  const config = loadConfig();
  
  if (config.remote.enabled && config.remote.url) {
    return { 
      url: normalizeBackendUrl(config.remote.url, 'openai'), 
      model: config.backends[config.defaultBackend]?.model || 'qwen2.5-7b-instruct',
      apiType: 'openai' 
    };
  }
  
  const backend = config.backends[config.defaultBackend];
  if (!backend?.enabled) {
    const lmstudio = config.backends.lmstudio;
    const ollama = config.backends.ollama;
    if (lmstudio?.enabled) {
      return { url: normalizeBackendUrl(lmstudio.url, lmstudio.apiType || 'openai'), model: lmstudio.model, apiType: lmstudio.apiType || 'openai' };
    }
    if (ollama?.enabled) {
      return { url: normalizeBackendUrl(ollama.url, ollama.apiType || 'ollama'), model: ollama.model, apiType: ollama.apiType || 'ollama' };
    }
    throw new Error(`No enabled backend found. Check your config at ${getConfigPath()}`);
  }
  
  return { url: normalizeBackendUrl(backend.url, backend.apiType || 'openai'), model: backend.model, apiType: backend.apiType || 'openai' };
}

export function getDBPath(): string {
  return path.join(os.homedir(), '.jot', 'notes.db');
}

export function getUserFilePath(): string {
  const config = loadConfig();
  const userFile = config.userFile || '~/.jot/user.md';
  return userFile.replace('~', os.homedir());
}

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

export interface Config {
  backends: {
    lmstudio?: BackendConfig;
    ollama?: BackendConfig;
  };
  defaultBackend: 'lmstudio' | 'ollama';
  remote: RemoteConfig;
}

const DEFAULT_CONFIG: Config = {
  backends: {
    lmstudio: {
      url: 'http://127.0.0.1:1234/v1/chat/completions',
      model: 'qwen3.5-9b',
      enabled: true,
      apiType: 'openai'
    },
    ollama: {
      url: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'gemma4:e4b',
      enabled: false,
      apiType: 'openai'
    }
  },
  defaultBackend: 'lmstudio',
  remote: {
    enabled: false,
    url: ''
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
      remote: { ...DEFAULT_CONFIG.remote, ...userConfig.remote }
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

export function setDefaultBackend(backend: 'lmstudio' | 'ollama'): Config {
  const current = loadConfig();
  current.defaultBackend = backend;
  saveConfig(current);
  return current;
}

export function setRemoteConfig(url: string, enabled: boolean = true): Config {
  const current = loadConfig();
  current.remote.enabled = enabled;
  current.remote.url = url;
  saveConfig(current);
  return current;
}

export function disableRemote(): Config {
  const current = loadConfig();
  current.remote.enabled = false;
  saveConfig(current);
  return current;
}

export function setBackendModel(backend: 'lmstudio' | 'ollama', model: string): Config {
  const current = loadConfig();
  if (current.backends[backend]) {
    current.backends[backend]!.model = model;
  }
  saveConfig(current);
  return current;
}

export function setBackendUrl(backend: 'lmstudio' | 'ollama', url: string): Config {
  const current = loadConfig();
  if (current.backends[backend]) {
    current.backends[backend]!.url = url;
  }
  saveConfig(current);
  return current;
}

export function setBackendApiType(backend: 'lmstudio' | 'ollama', apiType: ApiType): Config {
  const current = loadConfig();
  if (current.backends[backend]) {
    current.backends[backend]!.apiType = apiType;
  }
  saveConfig(current);
  return current;
}

export function getActiveBackend(): { url: string; model: string; apiType: ApiType } {
  const config = loadConfig();
  
  if (config.remote.enabled && config.remote.url) {
    return { 
      url: config.remote.url, 
      model: config.backends[config.defaultBackend]?.model || 'qwen3.5-9b',
      apiType: 'openai' 
    };
  }
  
  const backend = config.backends[config.defaultBackend];
  if (!backend?.enabled) {
    // Fall back to the first enabled backend
    const lmstudio = config.backends.lmstudio;
    const ollama = config.backends.ollama;
    if (lmstudio?.enabled) {
      return { url: lmstudio.url, model: lmstudio.model, apiType: lmstudio.apiType || 'openai' };
    }
    if (ollama?.enabled) {
      return { url: ollama.url, model: ollama.model, apiType: ollama.apiType || 'ollama' };
    }
    throw new Error(`No enabled backend found. Check your config at ${getConfigPath()}`);
  }
  
  return { url: backend.url, model: backend.model, apiType: backend.apiType || 'openai' };
}
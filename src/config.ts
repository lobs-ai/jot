import fs from 'fs';
import path from 'path';
import os from 'os';

export interface BackendConfig {
  url: string;
  model: string;
  enabled: boolean;
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
      url: 'http://localhost:1234/v1/chat/completions',
      model: 'qwen3.5-9b',
      enabled: true
    },
    ollama: {
      url: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3',
      enabled: false
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

export function getActiveBackend(): { url: string; model: string } {
  const config = loadConfig();
  
  if (config.remote.enabled && config.remote.url) {
    return { url: config.remote.url, model: config.backends[config.defaultBackend]?.model || 'qwen3.5-9b' };
  }
  
  const backend = config.backends[config.defaultBackend];
  if (!backend?.enabled) {
    throw new Error(`Backend ${config.defaultBackend} is not enabled. Check your config at ${getConfigPath()}`);
  }
  
  return { url: backend.url, model: backend.model };
}
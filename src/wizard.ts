import * as readline from 'readline';
import { saveConfig, loadConfig, Config, BackendConfig, UserProfile } from './config.js';

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function clearLine(): void {
  readline.moveCursor(process.stdout, 0, -1);
  readline.clearLine(process.stdout, 0);
}

async function fetchLMStudioModels(baseUrl: string): Promise<string[]> {
  try {
    const url = baseUrl.replace('/v1/chat/completions', '') + '/api/v0/models';
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json() as { data?: { id: string }[] };
      return data.data?.map(m => m.id) || [];
    }
  } catch {
    // failed to fetch
  }
  return [];
}

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const url = baseUrl.replace('/v1/chat/completions', '') + '/api/tags';
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json() as { models?: { name: string }[] };
      return data.models?.map(m => m.name) || [];
    }
  } catch {
    // failed to fetch
  }
  return [];
}

async function askBackend(): Promise<'lmstudio' | 'ollama' | 'custom'> {
  console.log('\n=== Jot Setup Wizard ===\n');
  console.log('Choose your AI backend:\n');
  console.log('  1) LM Studio');
  console.log('  2) Ollama');
  console.log('  3) Custom URL (connect to another machine)\n');

  const answer = await question('Which backend? (1/2/3) [1]: ');
  const choice = answer.toLowerCase() || '1';
  
  if (choice === '2') return 'ollama';
  if (choice === '3') return 'custom';
  return 'lmstudio';
}

async function askServerURL(backend: 'lmstudio' | 'ollama' | 'custom', defaultUrl?: string): Promise<string> {
  if (backend === 'custom') {
    console.log('\nCustom URL setup:\n');
    console.log('Enter the full API URL (e.g., http://192.168.1.100:1234/v1/chat/completions)\n');
    const url = await question('Server URL: ');
    return url;
  }

  const defaultURL = backend === 'lmstudio' 
    ? 'http://127.0.0.1:1234/v1/chat/completions'
    : 'http://127.0.0.1:11434/v1/chat/completions';

  console.log(`\nServer URL (${backend}):`);
  console.log(`Default: ${defaultURL}\n`);

  const url = await question(`Server URL [${defaultURL}]: `);
  return url || defaultURL;
}

async function askModelName(backend: 'lmstudio' | 'ollama', url: string): Promise<string> {
  console.log('\nFetching available models...\n');
  
  const models = backend === 'lmstudio' 
    ? await fetchLMStudioModels(url)
    : await fetchOllamaModels(url);

  if (models.length > 0) {
    console.log(`Available models on ${backend}:`);
    models.forEach((model, i) => console.log(`  ${i + 1}) ${model}`));
    console.log('');
    
    const answer = await question('Choose a model (number) or type custom name: ');
    const num = parseInt(answer);
    if (num > 0 && num <= models.length) {
      clearLine();
      return models[num - 1];
    }
    if (answer.trim()) {
      clearLine();
      return answer.trim();
    }
  } else {
    console.log(`Could not fetch models from ${url}`);
    console.log('Enter model name manually.\n');
  }

  const suggested = backend === 'lmstudio' ? 'qwen2.5-7b-instruct' : 'llama3.2';
  const model = await question(`Model name [${suggested}]: `);
  clearLine();
  return model || suggested;
}

async function askAnalysisOptions(): Promise<{
  extractActionItems: boolean;
  linkRelatedNotes: boolean;
  autoAnalyze: boolean;
}> {
  console.log('\nAI Analysis Options:\n');
  console.log('  1) Extract action items from notes (e.g., "finish review by Friday")');
  console.log('  2) Auto-link related notes based on content similarity');
  console.log('  3) Run analysis automatically after each note (recommended)\n');

  const actionItemsAnswer = await question('Extract action items? [Y/n]: ');
  const linkNotesAnswer = await question('Auto-link related notes? [Y/n]: ');
  const autoAnalyzeAnswer = await question('Auto-analyze notes after adding? [Y/n]: ');

  clearLine();
  clearLine();
  clearLine();

  return {
    extractActionItems: actionItemsAnswer.toLowerCase() !== 'n',
    linkRelatedNotes: linkNotesAnswer.toLowerCase() !== 'n',
    autoAnalyze: autoAnalyzeAnswer.toLowerCase() !== 'n'
  };
}

async function askUserProfile(existingName?: string): Promise<UserProfile> {
  console.log('\nUser Profile:\n');
  console.log('This helps Jot speak more naturally and avoid mixing you up with other people in your notes.\n');

  const defaultName = existingName || '';
  const name = await question(`Your name${defaultName ? ` [${defaultName}]` : ''}: `);
  const bio = await question('Short profile (optional, e.g. "University of Michigan student studying CS and using Jot for school + life admin"): ');

  clearLine();
  clearLine();

  return {
    name: name || defaultName,
    bio: bio || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  };
}

async function askCompletion(): Promise<void> {
  console.log('\n=== Setup Complete! ===\n');
  console.log('Quick start:');
  console.log('  jot note "my first note"          Add a note');
  console.log('  jot list                          See all notes');
  console.log('  jot search "keyword"             Search notes');
  console.log('  jot insights                       Get AI-powered insights\n');
  console.log('Run "jot" without arguments for full help.\n');
}

export async function runSetupWizard(): Promise<void> {
  const existingConfig = loadConfig();
  
  if (existingConfig.backends.lmstudio || existingConfig.backends.ollama) {
    const answer = await question('\nConfiguration exists. Re-run setup wizard? [y/N]: ');
    if (answer.toLowerCase() !== 'y') {
      clearLine();
      console.log('\nKeeping existing configuration.\n');
      return;
    }
    clearLine();
  }

  const backend = await askBackend();
  
  let serverUrl: string;
  let actualBackend: 'lmstudio' | 'ollama';
  
  if (backend === 'custom') {
    serverUrl = await askServerURL('custom');
    const isOllama = serverUrl.includes('11434');
    actualBackend = isOllama ? 'ollama' : 'lmstudio';
  } else {
    serverUrl = await askServerURL(backend);
    actualBackend = backend;
  }

  const model = await askModelName(actualBackend, serverUrl);
  const analysisOptions = await askAnalysisOptions();
  const profile = await askUserProfile(existingConfig.profile?.name);

  const lmstudioConfig: BackendConfig = {
    url: serverUrl,
    model: model,
    enabled: actualBackend === 'lmstudio',
    apiType: 'openai'
  };

  const ollamaConfig: BackendConfig = {
    url: serverUrl,
    model: model,
    enabled: actualBackend === 'ollama',
    apiType: actualBackend === 'ollama' ? 'ollama' : 'openai'
  };

  const newConfig: Config = {
    backends: {
      lmstudio: actualBackend === 'lmstudio' ? lmstudioConfig : { ...lmstudioConfig, enabled: false },
      ollama: actualBackend === 'ollama' ? ollamaConfig : { ...ollamaConfig, enabled: false }
    },
    defaultBackend: actualBackend,
    remote: { enabled: false, url: '' },
    analysis: {
      extractActionItems: analysisOptions.extractActionItems,
      linkRelatedNotes: analysisOptions.linkRelatedNotes,
      autoAnalyze: analysisOptions.autoAnalyze
    },
    profile
  };

  saveConfig(newConfig);
  await askCompletion();
}

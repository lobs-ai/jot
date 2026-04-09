import * as readline from 'readline';
import { saveConfig, loadConfig, Config, BackendConfig } from './config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim());
    });
  });
}

function clearLine(): void {
  readline.moveCursor(process.stdout, 0, -1);
  readline.clearLine(process.stdout, 0);
}

async function askBackend(): Promise<'lmstudio' | 'ollama'> {
  console.log('\n=== Jot Setup Wizard ===\n');
  console.log('First, let\'s choose your AI backend:\n');
  console.log('  1) LM Studio (recommended)');
  console.log('     - Download from https://lmstudio.ai/');
  console.log('     - Download a model and start the local server');
  console.log('');
  console.log('  2) Ollama');
  console.log('     - Download from https://ollama.ai/');
  console.log('     - Run: ollama serve && ollama pull <model>\n');

  const answer = await question('Which backend do you want to use? (1/2) [1]: ');
  const backend = answer === '2' ? 'ollama' : 'lmstudio';
  clearLine();
  return backend;
}

async function askModelName(backend: 'lmstudio' | 'ollama'): Promise<string> {
  console.log('\nModel setup:\n');
  
  if (backend === 'lmstudio') {
    console.log('In LM Studio:');
    console.log('  1. Download a model (try "qwen2.5-7b" or "llama3.2-3b" for starters)');
    console.log('  2. Click "Start Server" (usually at http://127.0.0.1:1234)');
    console.log('  3. The model name is shown in LM Studio (e.g., "qwen2.5-7b-instruct")\n');
  } else {
    console.log('In terminal:');
    console.log('  ollama pull <model>  (try "llama3.2" or "qwen2.5" or "gemma4")\n');
  }

  const suggested = backend === 'lmstudio' ? 'qwen2.5-7b-instruct' : 'llama3.2';
  const answer = await question(`Model name [${suggested}]: `);
  clearLine();
  return answer || suggested;
}

async function askServerURL(backend: 'lmstudio' | 'ollama'): Promise<string> {
  const defaultURL = backend === 'lmstudio' 
    ? 'http://127.0.0.1:1234/v1/chat/completions'
    : 'http://127.0.0.1:11434/v1/chat/completions';

  console.log('\nServer URL:\n');
  console.log(`Default for ${backend}: ${defaultURL}`);
  console.log('(Usually you can just press Enter)\n');

  const answer = await question(`Server URL [${defaultURL}]: `);
  clearLine();
  return answer || defaultURL;
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

  const extractActionItems = actionItemsAnswer.toLowerCase() !== 'n';
  const linkRelatedNotes = linkNotesAnswer.toLowerCase() !== 'n';
  const autoAnalyze = autoAnalyzeAnswer.toLowerCase() !== 'n';

  return { extractActionItems, linkRelatedNotes, autoAnalyze };
}

async function askCompletion(): Promise<void> {
  console.log('\n=== Setup Complete! ===\n');
  console.log('Quick start:');
  console.log('  jot note "my first note"          Add a note');
  console.log('  jot list                          See all notes');
  console.log('  jot search "keyword"             Search notes');
  console.log('  jot insights                      Get AI-powered insights\n');
  console.log('Run "jot" without arguments for full help.\n');
}

export async function runSetupWizard(configPath?: string): Promise<void> {
  try {
    const existingConfig = loadConfig(configPath);
    
    if (existingConfig.backends.lmstudio || existingConfig.backends.ollama) {
      const answer = await question('\nConfiguration exists. Re-run setup wizard? [y/N]: ');
      if (answer.toLowerCase() !== 'y') {
        clearLine();
        console.log('\nKeeping existing configuration.\n');
        rl.close();
        return;
      }
      clearLine();
    }

    const backend = await askBackend();
    const model = await askModelName(backend);
    const url = await askServerURL(backend);
    const analysisOptions = await askAnalysisOptions();

    const lmstudioConfig: BackendConfig = {
      url: backend === 'lmstudio' ? url : 'http://127.0.0.1:1234/v1/chat/completions',
      model: backend === 'lmstudio' ? model : 'qwen2.5-7b-instruct',
      enabled: backend === 'lmstudio',
      apiType: 'openai'
    };

    const ollamaConfig: BackendConfig = {
      url: backend === 'ollama' ? url : 'http://127.0.0.1:11434/v1/chat/completions',
      model: backend === 'ollama' ? model : 'llama3.2',
      enabled: backend === 'ollama',
      apiType: 'ollama'
    };

    const newConfig: Config = {
      backends: {
        lmstudio: lmstudioConfig,
        ollama: ollamaConfig
      },
      defaultBackend: backend,
      remote: { enabled: false, url: '' },
      analysis: {
        extractActionItems: analysisOptions.extractActionItems,
        linkRelatedNotes: analysisOptions.linkRelatedNotes,
        autoAnalyze: analysisOptions.autoAnalyze
      }
    };

    saveConfig(newConfig);
    await askCompletion();
  } finally {
    rl.close();
  }
}

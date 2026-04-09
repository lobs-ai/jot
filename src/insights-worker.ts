import { generateInsights, generateDeepInsights, saveInsights } from './insights.js';

async function main(): Promise<void> {
  const baseInsights = await generateInsights();
  const deepInsights = await generateDeepInsights();

  saveInsights({
    ...baseInsights,
    research_threads: deepInsights.research_threads,
    suggestions: deepInsights.suggestions,
    generated_at: new Date().toISOString()
  });
}

main().catch(() => process.exit(1));

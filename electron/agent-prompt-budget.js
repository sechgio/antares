'use strict';

const { SYSTEM_PROMPT } = require('./agent-prompts');

let tokenEstimator;

async function basePromptEstimate(specs, { defaultToolNames, reminderTexts }) {
  tokenEstimator ||= await import('@earendil-works/pi-ai/utils/estimate');
  const { estimateTextTokens } = tokenEstimator;
  const defaultNames = defaultToolNames(specs);
  const selected = defaultNames === null ? specs : specs.filter((spec) => defaultNames.includes(spec.name));
  const definitions = selected.map((spec) => ({
    name: spec.name,
    description: String(spec.description || spec.name),
    parameters: spec.inputSchema && typeof spec.inputSchema === 'object'
      ? spec.inputSchema
      : { type: 'object', properties: {} },
  }));
  const system = estimateTextTokens(SYSTEM_PROMPT);
  const tools = estimateTextTokens(JSON.stringify(definitions));
  const reminders = reminderTexts().reduce((total, text) => total + estimateTextTokens(text), 0);
  return {
    tokens: system + tools + reminders,
    system,
    tools,
    reminders,
    toolCount: definitions.length,
    toolSelection: defaultNames === null ? 'all' : 'default',
  };
}

module.exports = { basePromptEstimate };

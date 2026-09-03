import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createSeededRepository, DEMO_USER_ID } from '../data/index';
import {
  AnthropicLlmClient,
  DeterministicLlmClient,
  handleMessage,
  type AgentDeps,
  type LlmClient,
} from '../agent/index';

/**
 * Minimal chat harness for manual verification of the vertical slice.
 *
 *   npm run chat                     # interactive REPL
 *   npm run chat -- "msg one" "msg two"   # scripted: send each message in order
 *   npm run chat -- --demo           # run the four canonical slice messages
 *   npm run chat -- --llm=anthropic  # use the real Anthropic client (needs ANTHROPIC_API_KEY)
 *
 * Client selection: --llm=anthropic|deterministic, else KONA_LLM env, else
 * 'anthropic' when ANTHROPIC_API_KEY is set, else 'deterministic'.
 * State is in-memory only and resets each run.
 */

function pickLlm(args: string[]): { llm: LlmClient; name: string } {
  const flag = args.find((a) => a.startsWith('--llm='))?.split('=')[1];
  const choice = flag ?? process.env.KONA_LLM ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'deterministic');
  if (choice === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      process.stdout.write(
        'Note: ANTHROPIC_API_KEY is not set — the Anthropic client will fail on first call. ' +
          'Set it (see .env.example) or use --llm=deterministic.\n',
      );
    }
    return { llm: new AnthropicLlmClient(), name: `anthropic (${process.env.KONA_LLM_MODEL ?? 'claude-opus-5'})` };
  }
  return { llm: new DeterministicLlmClient(), name: 'deterministic' };
}

const DEMO_SCRIPT = [
  "Tomorrow I'm doing an 18km run at 6am.",
  'Actually I only ran 10km because my left hip hurt.',
  'I had one SIS gel and my 750ml bottle.',
  'My legs feel tired but okay.',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { llm, name } = pickLlm(args);
  const repo = await createSeededRepository();
  const deps: AgentDeps = { repo, llm };
  const conversationId = `conv_${Date.now()}`;
  const send = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId, message });

  const scripted = args.includes('--demo') ? DEMO_SCRIPT : args.filter((a) => !a.startsWith('--'));

  if (scripted.length > 0) {
    process.stdout.write(`[llm: ${name}]\n`);
    for (const message of scripted) {
      process.stdout.write(`\nyou › ${message}\n`);
      const turn = await send(message);
      process.stdout.write(`kona › ${turn.reply}\n`);
      process.stdout.write(`      [intent: ${turn.intent}${turn.safety.escalate ? ', safety: escalated' : ''}]\n`);
    }
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  process.stdout.write(`Kona (llm: ${name}). Type your message, or "exit" to quit.\n`);
  for (;;) {
    const message = (await rl.question('\nyou › ')).trim();
    if (!message || message === 'exit' || message === 'quit') break;
    const turn = await send(message);
    process.stdout.write(`kona › ${turn.reply}\n`);
    process.stdout.write(`      [intent: ${turn.intent}]\n`);
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createSeededRepository, DEMO_USER_ID } from '../data/index.js';
import { DeterministicLlmClient, handleMessage, type AgentDeps } from '../agent/index.js';

/**
 * Minimal chat harness for manual verification of the vertical slice.
 *
 *   npm run chat                     # interactive REPL
 *   npm run chat -- "msg one" "msg two"   # scripted: send each message in order
 *   npm run chat -- --demo           # run the four canonical slice messages
 *
 * State is in-memory only and resets each run.
 */

const DEMO_SCRIPT = [
  "Tomorrow I'm doing an 18km run at 6am.",
  'Actually I only ran 10km because my left hip hurt.',
  'I had one SIS gel and my 750ml bottle.',
  'My legs feel tired but okay.',
];

async function main(): Promise<void> {
  const repo = await createSeededRepository();
  const deps: AgentDeps = { repo, llm: new DeterministicLlmClient() };
  const conversationId = `conv_${Date.now()}`;
  const send = (message: string) =>
    handleMessage(deps, { userId: DEMO_USER_ID, conversationId, message });

  const args = process.argv.slice(2);
  const scripted = args.includes('--demo') ? DEMO_SCRIPT : args.filter((a) => !a.startsWith('--'));

  if (scripted.length > 0) {
    for (const message of scripted) {
      process.stdout.write(`\nyou › ${message}\n`);
      const turn = await send(message);
      process.stdout.write(`kona › ${turn.reply}\n`);
      process.stdout.write(`      [intent: ${turn.intent}${turn.safety.escalate ? ', safety: escalated' : ''}]\n`);
    }
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  process.stdout.write('Kona (deterministic slice). Type your message, or "exit" to quit.\n');
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

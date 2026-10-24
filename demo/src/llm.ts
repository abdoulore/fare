// The demo API's answer source: Claude through the Anthropic SDK when the host has
// credentials, otherwise a canned responder whose every answer is labeled simulated
// (owner decision, Oct 24).
//
// Privacy: the model provider sees the prompt, as any LLM API would (request content is
// a stated residual). It never sees who asked: no user id, no client address and no
// token goes upstream.

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MAX_PROMPT_CHARS = 4_000;

export interface Answer {
  text: string;
  /** True when no model ran: the canned responder answered. */
  simulated: boolean;
  model: string | null;
  /** True when the model declined the request. */
  refused?: boolean;
}

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Responder = (prompt: string) => Promise<Answer>;

const SYSTEM = 'You answer questions for an API demo. Be brief: at most three sentences.';

/** Deterministic canned answers, so the demo runs with no key and says so. */
export function cannedResponder(): Responder {
  return async (prompt) => ({
    text: `[simulated] No model API key on this host, so this answer is canned. You asked ${prompt.length} characters; a real deployment would send them to the model.`,
    simulated: true,
    model: null,
  });
}

/** Minimal surface of the SDK client this module uses, so tests can stand in for it. */
export interface MessagesClient {
  beta: { messages: { create(body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage> } };
}

export function claudeResponder(client: MessagesClient, model = DEFAULT_MODEL): Responder {
  return async (prompt) => {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: 'low' },
        // A safety decline is re-run server-side on Anthropic's recommended fallback.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new UpstreamError(429, 'model rate limited, try again shortly');
      if (error instanceof Anthropic.AuthenticationError) throw new UpstreamError(502, 'model credentials rejected');
      if (error instanceof Anthropic.BadRequestError) throw new UpstreamError(502, 'model refused the request format');
      if (error instanceof Anthropic.APIError) throw new UpstreamError(502, `model error ${error.status ?? ''}`.trim());
      throw new UpstreamError(502, 'model unreachable');
    }
    if (response.stop_reason === 'refusal') {
      return { text: 'The model declined to answer this request.', simulated: false, model: response.model, refused: true };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text, simulated: false, model: response.model };
  };
}

/** Claude when credentials are present, the canned responder otherwise. */
export function responderFromEnv(env: NodeJS.ProcessEnv = process.env): Responder {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
    return claudeResponder(new Anthropic(), env.FARE_MODEL || DEFAULT_MODEL);
  }
  return cannedResponder();
}

/**
 * Test stacks only: fails like an unreachable model whenever the prompt contains
 * `marker`, so the end-to-end test can show a token spent on a failed answer.
 */
export function failingOn(marker: string, inner: Responder): Responder {
  return async (prompt) => {
    if (prompt.includes(marker)) throw new UpstreamError(502, 'model unreachable');
    return inner(prompt);
  };
}

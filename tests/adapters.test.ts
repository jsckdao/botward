import { describe, expect, it } from 'vitest';
import { AnthropicClient } from '../src/llm/anthropic.js';
import { OpenAIClient } from '../src/llm/openai.js';
import type {
  ChatRequest,
} from '../src/llm/types.js';

interface StubOptions<T> {
  response: T;
  capture?: { request?: any };
}

function stubAnthropic(opts: StubOptions<unknown>) {
  return {
    messages: {
      create: async (req: any) => {
        if (opts.capture) opts.capture.request = req;
        return opts.response;
      },
    },
    beta: {
      messages: {
        create: async (req: any) => {
          if (opts.capture) opts.capture.request = req;
          return opts.response;
        },
      },
    },
  };
}

function stubOpenAI(opts: StubOptions<unknown>) {
  return {
    chat: {
      completions: {
        create: async (req: any) => {
          if (opts.capture) opts.capture.request = req;
          return opts.response;
        },
      },
    },
  };
}

const baseReq: ChatRequest = {
  system: 'be terse',
  messages: [
    {
      role: 'user',
      content: 'sum 1 and 2',
      toolResults: [
        { toolCallId: 't1', content: '3' },
        { toolCallId: 't2', content: 'oops', isError: true },
      ],
    },
  ],
  tools: [
    {
      name: 'sum',
      description: 'add two',
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
    },
  ],
};

describe('AnthropicClient', () => {
  it('translates tool_results into user-side tool_result blocks', async () => {
    const cap: { request?: any } = {};
    const client = new AnthropicClient({ apiKey: 'sk-fake' });
    (client as any).client = stubAnthropic({
      capture: cap,
      response: {
        id: 'msg_1',
        content: [{ type: 'text', text: '3' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });

    const resp = await client.chat(baseReq);
    expect(resp.stopReason).toBe('end_turn');
    expect(resp.message.content).toBe('3');

    // Verify request shape: system is now a text-block array (so cache_control
    // can be attached), and the user message carries 2 tool_result blocks.
    expect(cap.request!.system).toEqual([
      { type: 'text', text: 'be terse', cache_control: { type: 'ephemeral' } },
    ]);
    const userMsg = cap.request!.messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(userMsg.content[1]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't2',
      is_error: true,
    });
  });

  it('translates assistant tool_calls into tool_use blocks', async () => {
    const cap: { request?: any } = {};
    const client = new AnthropicClient({ apiKey: 'sk-fake' });
    (client as any).client = stubAnthropic({
      capture: cap,
      response: {
        id: 'msg_2',
        content: [],
        stop_reason: 'tool_use',
      },
    });

    const req: ChatRequest = {
      ...baseReq,
      messages: [
        {
          role: 'assistant',
          content: 'I will sum',
          toolCalls: [{ id: 'c1', name: 'sum', arguments: { a: 1, b: 2 } }],
        },
      ],
    };
    await client.chat(req);

    const assistantMsg = cap.request!.messages[0];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toHaveLength(2);
    expect(assistantMsg.content[0]).toMatchObject({ type: 'text', text: 'I will sum' });
    expect(assistantMsg.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'c1',
      name: 'sum',
      input: { a: 1, b: 2 },
    });
  });

  it('parses tool_use blocks from response', async () => {
    const client = new AnthropicClient({ apiKey: 'sk-fake' });
    (client as any).client = stubAnthropic({
      response: {
        id: 'msg_3',
        content: [
          { type: 'text', text: 'calling tool' },
          { type: 'tool_use', id: 'call_1', name: 'sum', input: { a: 1, b: 2 } },
        ],
        stop_reason: 'tool_use',
      },
    });
    const resp = await client.chat(baseReq);
    expect(resp.stopReason).toBe('tool_use');
    expect(resp.message.toolCalls).toEqual([
      { id: 'call_1', name: 'sum', arguments: { a: 1, b: 2 } },
    ]);
  });

  it('attaches cache_control to system, last tool, and last tool_result', async () => {
    const cap: { request?: any } = {};
    const client = new AnthropicClient({ apiKey: 'sk-fake' });
    (client as any).client = stubAnthropic({
      capture: cap,
      response: {
        id: 'msg_cache',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      },
    });

    await client.chat({
      ...baseReq,
      tools: [
        ...baseReq.tools,
        {
          name: 'diff',
          description: 'subtract',
          inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        },
      ],
      messages: [
        {
          role: 'user',
          content: '',
          toolResults: [
            ...baseReq.messages[0].toolResults!,
            { toolCallId: 't3', content: '5' },
          ],
        },
      ],
    });

    // system: 1-element array with cache_control on the (only) block
    const sys = cap.request!.system;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys).toHaveLength(1);
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });

    // tools: only the LAST tool carries cache_control
    const tools = cap.request!.tools;
    expect(tools).toHaveLength(2);
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });

    // tool_results: only the LAST result carries cache_control
    const trs = cap.request!.messages[0].content;
    expect(trs).toHaveLength(3);
    expect(trs[0].cache_control).toBeUndefined();
    expect(trs[trs.length - 1].cache_control).toEqual({ type: 'ephemeral' });

    // beta header for prompt caching is set
    expect(cap.request!.betas).toContain('prompt-caching-2024-07-31');
  });
});

describe('OpenAIClient', () => {
  it('emits system as first message and one role:tool per result', async () => {
    const cap: { request?: any } = {};
    const client = new OpenAIClient({ apiKey: 'sk-fake' });
    (client as any).client = stubOpenAI({
      capture: cap,
      response: {
        choices: [
          {
            message: { role: 'assistant', content: '3' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    });

    const resp = await client.chat(baseReq);
    expect(resp.stopReason).toBe('end_turn');
    expect(resp.message.content).toBe('3');

    expect(cap.request!.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    const toolMsgs = cap.request!.messages.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: '3' });
    expect(toolMsgs[1]).toMatchObject({ role: 'tool', tool_call_id: 't2', content: 'oops' });
  });

  it('wraps tools in { type: function }', async () => {
    const cap: { request?: any } = {};
    const client = new OpenAIClient({ apiKey: 'sk-fake' });
    (client as any).client = stubOpenAI({
      capture: cap,
      response: {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      },
    });
    await client.chat(baseReq);
    expect(cap.request!.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'sum', description: 'add two' },
    });
  });

  it('serializes assistant tool_calls.arguments as JSON string', async () => {
    const cap: { request?: any } = {};
    const client = new OpenAIClient({ apiKey: 'sk-fake' });
    (client as any).client = stubOpenAI({
      capture: cap,
      response: {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      },
    });
    const req: ChatRequest = {
      ...baseReq,
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'sum', arguments: { a: 1, b: 2 } }],
        },
      ],
    };
    await client.chat(req);
    // messages[0] is the system message, messages[1] is the assistant turn.
    const asst = cap.request!.messages[1];
    expect(asst.tool_calls[0]).toMatchObject({
      id: 'c1',
      type: 'function',
      function: { name: 'sum', arguments: '{"a":1,"b":2}' },
    });
  });

  it('parses response tool_calls back to arguments object', async () => {
    const client = new OpenAIClient({ apiKey: 'sk-fake' });
    (client as any).client = stubOpenAI({
      response: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'sum', arguments: '{"a":1,"b":2}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    });
    const resp = await client.chat(baseReq);
    expect(resp.stopReason).toBe('tool_use');
    expect(resp.message.toolCalls).toEqual([
      { id: 'call_1', name: 'sum', arguments: { a: 1, b: 2 } },
    ]);
  });
});
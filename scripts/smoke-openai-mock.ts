// Verify the OpenAI adapter correctly translates messages in and out by
// wrapping the real SDK with a stubbed chat.completions.create.
import { OpenAIClient } from '../src/llm/openai.js';

let capturedRequest: any = null;

const stub = {
  chat: {
    completions: {
      create: async (req: any) => {
        capturedRequest = req;
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'echoed back',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'sum',
                      arguments: JSON.stringify({ a: 1, b: 2 }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    },
  },
};

const client = new OpenAIClient({ apiKey: 'sk-fake' });
// Force the SDK to use our stub.
(client as any).client = stub;

const resp = await client.chat({
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
    { name: 'sum', description: 'add two', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  ],
});

console.log('captured system message:', capturedRequest.messages[0]);
console.log('captured tool message count:', capturedRequest.messages.filter((m: any) => m.role === 'tool').length);
console.log('captured tool message ids:', capturedRequest.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id));
console.log('captured tools[0]:', JSON.stringify(capturedRequest.tools[0], null, 2));
console.log('response stopReason:', resp.stopReason);
console.log('response toolCalls:', resp.message.toolCalls);
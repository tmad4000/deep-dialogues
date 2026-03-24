export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Deep Dialogues API',
      version: '1.0.0',
      description: 'Submit and browse curated AI conversations.',
    },
    servers: [{ url: 'https://deep-dialogues.ideaflow.app/api' }],
    paths: {
      '/conversations': {
        post: {
          summary: 'Submit a conversation',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'messages'],
                  properties: {
                    title: { type: 'string' },
                    messages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['role', 'content'],
                        properties: {
                          role: { type: 'string', enum: ['human', 'assistant', 'user', 'system'] },
                          content: { type: 'string' },
                        },
                      },
                    },
                    contributor_name: { type: 'string' },
                    ai_model: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    description: { type: 'string' },
                    highlights: { type: 'array', items: { type: 'string' } },
                    original_url: { type: 'string' },
                    commentary: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Conversation created' } },
        },
        get: {
          summary: 'List published conversations',
          parameters: [
            { name: 'contributor', in: 'query', schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: { description: 'Array of conversations' } },
        },
      },
      '/conversations/{slug}': {
        get: {
          summary: 'Get a single conversation with full messages',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Conversation object' }, 404: { description: 'Not found' } },
        },
      },
      '/contributors': {
        get: {
          summary: 'List all contributors with conversation counts',
          responses: { 200: { description: 'Array of {contributor_name, count}' } },
        },
      },
    },
  });
}

const BASE_URL = 'https://deep-dialogues.ideaflow.app';

const EXAMPLE_SUBMIT = `curl -X POST ${BASE_URL}/api/conversations \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "On the Nature of Consciousness",
    "messages": [
      {"role": "human", "content": "What do you think consciousness actually is?"},
      {"role": "assistant", "content": "That is one of the deepest questions..."}
    ],
    "contributor_name": "Jane Smith",
    "ai_model": "Claude Opus 4",
    "tags": ["philosophy", "consciousness"]
  }'`;

const ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/conversations',
    summary: 'Submit a conversation',
    description: 'Submit a new conversation for review. No authentication required — submissions go to a pending queue.',
    fields: [
      { name: 'title', type: 'string', required: true, desc: 'Title of the conversation' },
      { name: 'messages', type: 'array', required: true, desc: 'Array of {role, content} objects. Roles: "human", "assistant", "user", "system"' },
      { name: 'contributor_name', type: 'string', required: false, desc: 'Who is sharing this conversation' },
      { name: 'ai_model', type: 'string', required: false, desc: 'Which AI model (e.g. "Claude Opus 4", "GPT-4o")' },
      { name: 'tags', type: 'string[]', required: false, desc: 'Topic tags like ["philosophy", "creativity"]' },
      { name: 'description', type: 'string', required: false, desc: 'What makes this conversation notable' },
      { name: 'highlights', type: 'string[]', required: false, desc: 'Notable excerpts or best quotes' },
      { name: 'original_url', type: 'string', required: false, desc: 'Link to the original conversation' },
      { name: 'commentary', type: 'string', required: false, desc: 'Why this conversation matters' },
    ],
  },
  {
    method: 'GET',
    path: '/api/conversations',
    summary: 'List published conversations',
    description: 'Returns conversation summaries (without full messages). Supports filtering and pagination.',
    fields: [
      { name: 'contributor', type: 'query', required: false, desc: 'Filter by contributor name' },
      { name: 'tag', type: 'query', required: false, desc: 'Filter by tag' },
      { name: 'limit', type: 'query', required: false, desc: 'Max results (default 20, max 100)' },
      { name: 'offset', type: 'query', required: false, desc: 'Pagination offset (default 0)' },
    ],
  },
  {
    method: 'GET',
    path: '/api/conversations/{slug}',
    summary: 'Get a single conversation',
    description: 'Returns the full conversation object including all messages.',
    fields: [],
  },
  {
    method: 'GET',
    path: '/api/contributors',
    summary: 'List contributors',
    description: 'Returns an array of {contributor_name, count} sorted by most conversations.',
    fields: [],
  },
  {
    method: 'GET',
    path: '/api/docs',
    summary: 'OpenAPI schema',
    description: 'Returns the OpenAPI 3.0 schema for all endpoints.',
    fields: [],
  },
];

function methodClass(method) {
  return method === 'POST' ? 'method-post' : 'method-get';
}

export function renderApi(container) {
  container.innerHTML = `
    <div class="api-docs fade-in">
      <header class="submit-header">
        <h1 class="submit-title">API</h1>
        <p class="submit-subtitle">
          Submit and browse conversations programmatically. No authentication required.
          <br>LLMs and agents: read <a href="/llms.txt" target="_blank" style="color: var(--accent-feature)">/llms.txt</a> for a machine-friendly description.
        </p>
      </header>

      <div class="api-base-url">
        <span class="api-label">Base URL</span>
        <code>${BASE_URL}</code>
      </div>

      <div class="api-endpoints">
        ${ENDPOINTS.map(ep => `
          <div class="api-endpoint">
            <div class="api-endpoint-header">
              <span class="api-method ${methodClass(ep.method)}">${ep.method}</span>
              <code class="api-path">${ep.path}</code>
            </div>
            <p class="api-endpoint-desc">${ep.description}</p>
            ${ep.fields.length > 0 ? `
              <table class="api-fields">
                <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
                <tbody>
                  ${ep.fields.map(f => `
                    <tr>
                      <td><code>${f.name}</code></td>
                      <td><code>${f.type}</code></td>
                      <td>${f.required ? 'Yes' : 'No'}</td>
                      <td>${f.desc}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : ''}
          </div>
        `).join('')}
      </div>

      <div class="api-example">
        <div class="api-label">Example: submit a conversation</div>
        <pre class="api-code"><code>${EXAMPLE_SUBMIT}</code></pre>
      </div>
    </div>
  `;
}

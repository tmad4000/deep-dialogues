import { parseConversation } from '../lib/parser.js';
import { submitConversation } from '../lib/store.js';
import { fetchShareLink } from '../lib/fetcher.js';

const PASTE_PLACEHOLDER = `Paste a conversation here...\n\nFormat: each message starts with a role label like:\n\nHuman: What is consciousness?\n\nClaude: That depends on what framework...\n\nOr upload a JSONL file from Claude Code.`;

export function renderSubmit(container) {
  let parsed = null;
  let activeTab = 'link';
  let submitting = false;
  let submitted = false;
  let fetching = false;
  let fetchError = null;

  function render() {
    if (submitted) {
      renderSuccess();
      return;
    }

    const linkTabHTML = `
      <div class="form-group" style="margin-bottom: 1rem;">
        <label class="form-label">Share link</label>
        <input class="form-input" id="link-input" type="url"
          placeholder="https://claude.ai/share/... or https://chatgpt.com/share/..."
          style="font-family: var(--font-mono); font-size: 0.85rem;">
      </div>
      ${fetchError ? `<p style="color: var(--accent-feature); font-size: 0.85rem; margin-bottom: 1rem;">${fetchError}</p>` : ''}
      <div class="submit-actions">
        <button class="btn-primary" id="fetch-btn" ${fetching ? 'disabled' : ''}>
          ${fetching ? 'Fetching...' : 'Fetch conversation'}
        </button>
      </div>
      <p style="font-size: 0.78rem; color: var(--ink-30); margin-top: 0.75rem;">
        Supports Claude, ChatGPT, and other AI share links.
        If auto-fetch doesn't work, copy the conversation text and use the "Paste text" tab.
      </p>
    `;

    const pasteTabHTML = `
      <textarea class="paste-area" id="paste-input" placeholder="${PASTE_PLACEHOLDER.replace(/"/g, '&quot;')}"></textarea>
      <div class="submit-actions">
        <button class="btn-primary" id="parse-btn">Preview conversation</button>
      </div>
    `;

    const fileTabHTML = `
      <div class="file-drop-zone" id="drop-zone">
        <span class="drop-icon">+</span>
        <span class="drop-text">Drop a file here or click to browse</span>
        <span class="drop-hint">.jsonl (Claude Code) &middot; .json (ChatGPT export) &middot; .txt</span>
        <input type="file" id="file-input" accept=".jsonl,.json,.txt,.md" style="display:none">
      </div>
    `;

    const tabContent = activeTab === 'link' ? linkTabHTML
      : activeTab === 'paste' ? pasteTabHTML
      : fileTabHTML;

    container.innerHTML = `
      <div class="submit fade-in">
        <header class="submit-header">
          <h1 class="submit-title">Upload a Conversation</h1>
          <p class="submit-subtitle">
            Upload an interesting, beautiful, or illuminating AI conversation.
            Paste a share link, paste the text, or upload a file.
          </p>
        </header>

        <div class="submit-tabs">
          <button class="submit-tab ${activeTab === 'link' ? 'active' : ''}" data-tab="link">Paste link</button>
          <button class="submit-tab ${activeTab === 'paste' ? 'active' : ''}" data-tab="paste">Paste text</button>
          <button class="submit-tab ${activeTab === 'file' ? 'active' : ''}" data-tab="file">Upload file</button>
        </div>

        ${tabContent}

        ${parsed ? renderPreview() : ''}
      </div>
    `;

    bindEvents();
  }

  function renderPreview() {
    const messages = parsed.messages || [];
    if (messages.length === 0) return '';

    return `
      <div class="preview-section">
        <div class="preview-label">Preview (${messages.length} messages detected)</div>

        <div class="meta-form">
          <div class="form-group">
            <label class="form-label">Title</label>
            <input class="form-input" id="meta-title" type="text"
              placeholder="Give this conversation a name"
              value="${parsed.title ? parsed.title.replace(/"/g, '&quot;') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Your name (optional)</label>
            <input class="form-input" id="meta-contributor" type="text"
              placeholder="How should you be credited?">
          </div>
          <div class="form-group">
            <label class="form-label">Tags (comma separated)</label>
            <input class="form-input" id="meta-tags" type="text"
              placeholder="consciousness, philosophy, coding">
          </div>
          <div class="form-group">
            <label class="form-label">Original link</label>
            <input class="form-input" id="meta-url" type="url"
              placeholder="https://claude.ai/share/..."
              value="${parsed.original_url ? parsed.original_url.replace(/"/g, '&quot;') : ''}">
          </div>
        </div>

        <div class="conversation-flow" style="margin-top: 2rem; max-height: 400px; overflow-y: auto; border: 1px solid var(--ink-08); border-radius: 8px; padding: 1.5rem;">
          ${messages.slice(0, 6).map(msg => {
            const isHuman = msg.role === 'human';
            return `
              <div class="message ${isHuman ? 'message-human' : 'message-ai'}" style="opacity:1">
                <div class="message-label">${isHuman ? 'Human' : (parsed.ai_model || 'AI')}</div>
                <div class="message-body">${msg.content}</div>
              </div>
            `;
          }).join('')}
          ${messages.length > 6 ? `<p style="text-align:center; color: var(--ink-30); font-size: 0.85rem; padding: 1rem 0;">+ ${messages.length - 6} more messages</p>` : ''}
        </div>

        <div class="submit-actions" style="margin-top: 1.5rem;">
          <button class="btn-primary" id="submit-btn" ${submitting ? 'disabled' : ''}>
            ${submitting ? 'Submitting...' : 'Submit for review'}
          </button>
          <button class="btn-secondary" id="reset-btn">Start over</button>
        </div>
      </div>
    `;
  }

  function renderSuccess() {
    container.innerHTML = `
      <div class="submit fade-in">
        <div class="submit-success">
          <div class="check">&#10003;</div>
          <h3>Conversation submitted</h3>
          <p>It will appear in the gallery once reviewed. Thank you for sharing.</p>
          <button class="btn-secondary" id="another-btn">Submit another</button>
        </div>
      </div>
    `;

    container.querySelector('#another-btn')?.addEventListener('click', () => {
      parsed = null;
      submitted = false;
      render();
    });
  }

  function bindEvents() {
    // Tab switching
    container.querySelectorAll('.submit-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        parsed = null;
        fetchError = null;
        render();
      });
    });

    // Fetch link button
    container.querySelector('#fetch-btn')?.addEventListener('click', async () => {
      const input = container.querySelector('#link-input');
      const url = input?.value?.trim();
      if (!url) return;

      fetching = true;
      fetchError = null;
      render();

      try {
        const result = await fetchShareLink(url);
        parsed = result;
        parsed.original_url = url;
        fetching = false;
        render();
      } catch (e) {
        fetching = false;
        fetchError = e.message || 'Could not fetch conversation. Try pasting the text directly.';
        render();
      }
    });

    // Parse button
    container.querySelector('#parse-btn')?.addEventListener('click', () => {
      const input = container.querySelector('#paste-input');
      if (input && input.value.trim()) {
        try {
          parsed = parseConversation(input.value);
          render();
        } catch (e) {
          alert('Could not parse conversation: ' + e.message);
        }
      }
    });

    // File drop zone
    const dropZone = container.querySelector('#drop-zone');
    const fileInput = container.querySelector('#file-input');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
      });
    }

    // Submit button
    container.querySelector('#submit-btn')?.addEventListener('click', handleSubmit);

    // Reset button
    container.querySelector('#reset-btn')?.addEventListener('click', () => {
      parsed = null;
      render();
    });
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        parsed = parseConversation(e.target.result);
        render();
      } catch (err) {
        alert('Could not parse file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!parsed || submitting) return;

    const title = container.querySelector('#meta-title')?.value?.trim();
    if (!title) {
      alert('Please add a title for this conversation.');
      return;
    }

    submitting = true;
    render();

    const tagsInput = container.querySelector('#meta-tags')?.value || '';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const conversation = {
      slug,
      title,
      contributor_name: container.querySelector('#meta-contributor')?.value?.trim() || null,
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      original_url: container.querySelector('#meta-url')?.value?.trim() || null,
      ai_model: parsed.ai_model || 'AI',
      messages: parsed.messages,
      turn_count: parsed.messages.length,
    };

    try {
      await submitConversation(conversation);
      submitted = true;
      submitting = false;
      render();
    } catch (err) {
      submitting = false;
      console.error('Submit error:', err);
      alert('Submission failed: ' + err.message + '\n\nThe gallery may not be connected to a database yet. Your conversation was parsed successfully though!');
      render();
    }
  }

  render();
}

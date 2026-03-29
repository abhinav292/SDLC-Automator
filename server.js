import express from 'express';
import cors from 'cors';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const { Pool } = pg;
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

// Helper to safely execute queries if DB is connected
const safeQuery = async (queryText, params) => {
  if (!pool) return { rows: [] };
  return await pool.query(queryText, params);
};

// ─── TRANSCRIPT PRE-PROCESSING ────────────────────────────────────────────────

const FILLER_PHRASES = /\b(um+|uh+|er+|like,?\s|you know,?\s|so,?\s|basically,?\s|right,?\s|okay so,?\s|i mean,?\s|sort of,?\s|kind of,?\s|actually,?\s|literally,?\s)\b/gi;

const cleanTranscriptForExtraction = (raw) => {
  let t = raw
    .replace(FILLER_PHRASES, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Deduplicate consecutive repeated sentences (speech recognition artefacts)
  const sentences = t.split(/(?<=[.!?])\s+/);
  const deduped = sentences.filter((s, i) => i === 0 || s.trim() !== sentences[i - 1].trim());
  return deduped.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
};

// Chunk a long transcript into overlapping segments (by character count)
const CHUNK_SIZE = 60000;   // chars per chunk (~15k tokens at ~4 chars/token)
const CHUNK_OVERLAP = 2000; // overlap so context isn't lost at boundaries

const chunkTranscript = (text) => {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + CHUNK_SIZE));
    offset += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
};

// Simple in-memory extraction cache (keyed by transcript hash, per session)
const extractionCache = new Map();

const simpleHash = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
};

// ─── AI MODEL CONFIGURATION ───────────────────────────────────────────────────
// Change this one constant to switch all AI calls across the app.
// google/gemini-2.0-flash-001: ~$0.10/M input, ~$0.40/M output, 1M-token context window.
const AI_MODEL = 'google/gemini-2.0-flash-001';

// ─── SHARED AI CALL HELPER ────────────────────────────────────────────────────

const callAI = async (model, messages, temperature = 0.3, extraBody = {}) => {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing AI API Key (OPENROUTER_API_KEY or OPENAI_API_KEY) in .env');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
      'X-Title': 'SDLC Autopilot'
    },
    body: JSON.stringify({ model, messages, temperature, ...extraBody })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
  }
  return response.json();
};

// Parse a JSON array of stories from AI response content (with fallback recovery)
const parseStoriesFromContent = (rawContent) => {
  const content = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Attempt 1: direct JSON parse
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  // Attempt 2: greedy regex for first array
  const m = content.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }

  // Attempt 3: balanced-brace recovery (handles mid-JSON truncation)
  const arrayStart = content.indexOf('[');
  if (arrayStart !== -1) {
    const partial = content.slice(arrayStart);
    const recovered = [];
    let depth = 0, start = -1;
    for (let i = 0; i < partial.length; i++) {
      if (partial[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (partial[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try { recovered.push(JSON.parse(partial.slice(start, i + 1))); } catch {}
          start = -1;
        }
      }
    }
    if (recovered.length > 0) {
      console.warn(`[extract] Recovered ${recovered.length} story object(s) via brace-balancing.`);
      return recovered;
    }
  }

  return null;
};

// ─── AI EXTRACTION ────────────────────────────────────────────────────────────

app.post('/extract', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  // Cache key is based on raw text so distinct inputs always get distinct results
  const cacheKey = simpleHash(text);
  if (extractionCache.has(cacheKey)) {
    console.log(`[extract] Cache hit for key ${cacheKey}`);
    return res.json({ ...extractionCache.get(cacheKey), cached: true });
  }

  // Pre-process: strip filler, collapse whitespace, deduplicate sentences
  const cleaned = cleanTranscriptForExtraction(text);

  const prompt = `You are a senior TPM extracting Jira user stories from a meeting transcript. Return ONLY a raw JSON array — first char "[", last char "]", no markdown fences, no preamble. Always return at least one story.

SCHEMA (all fields required):
- "id": "story-1", "story-2", … (sequential)
- "title": action-oriented, max 80 chars
- "description": "As a [persona], I want to [action] so that [benefit]"
- "acceptanceCriteria": 3–5 plain-English positive criteria (testable, specific)
- "negativeAcceptanceCriteria": 2–4 Given/When/Then failure/edge-case criteria (include auth + invalid-input cases)
- "storyPoints": Fibonacci 1|2|3|5|8|13
- "adjustedPoints": same as storyPoints initially
- "priority": "High"|"Medium"|"Low" (High=blocks others/revenue/security)
- "labels": 1–3 from: api|auth|frontend|backend|database|payments|notifications|reporting|search|infrastructure|security|performance|data-migration|third-party|mobile|testing
- "technicalNotes": 1–3 developer-facing sentences (frameworks, patterns, constraints, API design)
- "qaScenarios": 2–3 complete Gherkin strings: "Feature: X\\n\\n  Scenario: Y\\n    Given ...\\n    When ...\\n    Then ..."
- "riskFlags": 0–4 objects {id:"r-1", type:"warning"|"error", text:"..."} — NEVER plain strings, [] if none
- "solution": {"options":[{id,name,description,pros:[],cons:[],complexity:"Low"|"Medium"|"High",recommended:true|false}]} — exactly one recommended:true
- "epic": short epic/feature-area name shared by related stories (e.g. "User Auth", "Payments")
- "dependencies": [] or ["story-1", …]
- "status": "pending"

RULES:
1. Extract EVERY distinct independently-deliverable feature — no artificial cap; complex transcripts may yield 10+ stories.
2. Merge duplicate mentions into one story.
3. Infer at least 1 story even from vague/short transcripts.
4. riskFlags must always be objects {id,type,text} — never strings.
5. qaScenarios must be complete Gherkin, not just titles.
6. Flag High priority for: blocking work, security/auth, customer-facing revenue impact, urgent deadline.
7. Risk keywords: performance, SLA, migration, third-party, GDPR, PII, cost, TBD, breaking change.

TRANSCRIPT:
`;

  // Helper: run a single extraction AI call for one chunk of text
  const runExtractionCall = async (chunk) => {
    const fullPrompt = prompt + chunk;
    const data = await callAI(AI_MODEL, [{ role: 'user', content: fullPrompt }], 0.3);
    const rawContent = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(`[extract] finish_reason=${finishReason} input_chars=${chunk.length} tokens=${JSON.stringify(data.usage)}`);
    if (finishReason === 'length') {
      console.warn('[extract] finish_reason=length on a chunk — some stories in this segment may be truncated.');
    }
    return { rawContent, finishReason, usage: data.usage, model: data.model };
  };

  try {
    // Chunk the cleaned transcript if it's very long
    const chunks = chunkTranscript(cleaned);
    console.log(`[extract] Transcript: ${text.length} chars raw → ${cleaned.length} chars cleaned → ${chunks.length} chunk(s)`);

    const allStories = [];
    let lastUsage = null, lastModel = null, anyTruncated = false;

    for (let i = 0; i < chunks.length; i++) {
      const { rawContent, finishReason, usage, model } = await runExtractionCall(chunks[i]);
      lastUsage = usage; lastModel = model;
      if (finishReason === 'length') anyTruncated = true;

      const parsed = parseStoriesFromContent(rawContent);
      if (!parsed || parsed.length === 0) {
        console.warn(`[extract] Chunk ${i + 1}/${chunks.length} returned no stories.`);
        continue;
      }
      allStories.push(...parsed);
    }

    if (allStories.length === 0) {
      return res.status(422).json({ error: 'AI returned no stories. The transcript may be too short or unclear. Please add more detail and try again.' });
    }

    // De-duplicate stories by title similarity when multiple chunks were used
    let finalStories = allStories;
    if (chunks.length > 1) {
      const seen = new Set();
      finalStories = allStories.filter(s => {
        const key = (s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      console.log(`[extract] Merged ${allStories.length} stories → ${finalStories.length} after de-duplication`);
    }

    // Re-sequence story IDs to be contiguous
    finalStories = finalStories.map((s, i) => ({ ...s, id: `story-${i + 1}` }));

    const result = { stories: finalStories, model: lastModel, usage: lastUsage, truncated: anyTruncated };
    extractionCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Extraction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── JIRA WRITE-ACCESS DIAGNOSTIC ────────────────────────────────────────────
// Creates a minimal test issue and immediately deletes it to verify write access.
// Returns { success, key, error, detail, warnings }

app.post('/diagnose-jira', async (req, res) => {
  const projectKey = process.env.JIRA_PROJECT_KEY || 'KAN';
  const domain = process.env.ATLASSIAN_DOMAIN || '';
  const email = process.env.ATLASSIAN_EMAIL || '';
  const token = process.env.ATLASSIAN_API_TOKEN || '';

  if (!domain || !email || !token) {
    return res.json({ success: false, error: 'Atlassian credentials not configured (ATLASSIAN_DOMAIN / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN missing)' });
  }

  const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  const baseUrl = `https://${domain}/rest/api/3`;

  const attempts = [
    // Attempt 1: Story with Story Points
    { fields: { project: { key: projectKey }, summary: '[SDLC Autopilot] Connection test — delete me', issuetype: { name: 'Story' }, customfield_10016: 1 }, label: 'Story + Story Points' },
    // Attempt 2: Story without Story Points
    { fields: { project: { key: projectKey }, summary: '[SDLC Autopilot] Connection test — delete me', issuetype: { name: 'Story' } }, label: 'Story only' },
    // Attempt 3: Task (fallback issuetype)
    { fields: { project: { key: projectKey }, summary: '[SDLC Autopilot] Connection test — delete me', issuetype: { name: 'Task' } }, label: 'Task' },
  ];

  let lastError = null;
  const warnings = [];

  for (const attempt of attempts) {
    try {
      const createRes = await fetch(`${baseUrl}/issue`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ fields: attempt.fields })
      });
      const createData = await createRes.json();

      if (createRes.ok && createData.key) {
        if (attempt.label !== attempts[0].label) {
          warnings.push(`Used fallback attempt: "${attempt.label}" — ${lastError || 'previous attempt rejected a field'}`);
        }
        // Immediately delete the test issue
        try {
          await fetch(`${baseUrl}/issue/${createData.key}`, {
            method: 'DELETE',
            headers: { 'Authorization': authHeader }
          });
        } catch {}
        return res.json({ success: true, key: createData.key, warnings });
      }

      lastError = createData.errorMessages?.join(', ') || JSON.stringify(createData.errors || createData).slice(0, 200);
    } catch (err) {
      lastError = err.message;
    }
  }

  return res.json({ success: false, error: lastError, detail: 'All issue creation attempts failed. Check your Jira project key and permissions.' });
});

// ─── VOICE TRANSCRIPT CLEANUP ─────────────────────────────────────────────────

app.post('/clean-transcript', async (req, res) => {
  const { rawTranscript } = req.body;
  if (!rawTranscript) return res.status(400).json({ error: 'No transcript provided' });

  const prompt = `You are a meeting transcript editor. The following raw text was produced by browser speech recognition and may contain errors, filler words, and poor formatting.

Clean it up following these rules:
1. Remove filler words (um, uh, like, you know, so, basically, right)
2. Add proper punctuation and capitalization throughout
3. Fix obvious speech recognition errors, especially for technical terms (APIs, framework names, etc.)
4. Add paragraph breaks at natural topic changes
5. If you can detect multiple speakers from context (e.g., "I said... they said..."), prefix turns with "Speaker 1:", "Speaker 2:", etc.
6. Preserve ALL actual content — do not summarize or remove any requirements, decisions, or action items

Return ONLY the cleaned transcript text. No preamble, no explanation.

RAW TRANSCRIPT:
${rawTranscript.slice(0, 8000)}`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.2);
    const cleaned = data.choices?.[0]?.message?.content?.trim() || rawTranscript;
    res.json({ cleaned, model: data.model, fallback: false });
  } catch (err) {
    console.error('Transcript cleanup failed:', err);
    res.json({ cleaned: rawTranscript, fallback: true });
  }
});

// ─── PIPELINE RUNS ────────────────────────────────────────────────────────────

app.get('/pipelines', async (_req, res) => {
  try {
    const result = await safeQuery('SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 20');
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

app.post('/pipelines', async (req, res) => {
  const { fileNames, transcriptSummary } = req.body;
  try {
    const result = await safeQuery(
      `INSERT INTO pipeline_runs (file_names, transcript_summary, status)
       VALUES ($1, $2, 'extracting') RETURNING *`,
      [JSON.stringify(fileNames || []), transcriptSummary || '']
    );
    res.json(result.rows[0] || { id: 'mock-pipeline-run-id' });
  } catch (err) {
    res.json({ id: 'mock-pipeline-run-id' });
  }
});

app.get('/pipelines/:id', async (req, res) => {
  try {
    const pipeline = await safeQuery('SELECT * FROM pipeline_runs WHERE id = $1', [req.params.id]);
    const stories = await safeQuery('SELECT * FROM stories WHERE pipeline_id = $1', [req.params.id]);
    const audit = await safeQuery('SELECT * FROM audit_log WHERE pipeline_id = $1 ORDER BY created_at', [req.params.id]);
    if (!pipeline.rows[0]) return res.json({ id: req.params.id, MockData: true });
    res.json({ ...pipeline.rows[0], stories: stories.rows, audit: audit.rows });
  } catch (err) {
    res.json({ id: req.params.id, MockData: true });
  }
});

app.patch('/pipelines/:id', async (req, res) => {
  const { status, storyCount, approvedCount, jiraKeys, confluenceUrl, notes } = req.body;
  try {
    const result = await safeQuery(
      `UPDATE pipeline_runs SET
        status = COALESCE($1, status),
        story_count = COALESCE($2, story_count),
        approved_count = COALESCE($3, approved_count),
        jira_keys = COALESCE($4, jira_keys),
        confluence_url = COALESCE($5, confluence_url),
        notes = COALESCE($6, notes),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [status, storyCount, approvedCount, jiraKeys ? JSON.stringify(jiraKeys) : null, confluenceUrl, notes, req.params.id]
    );
    res.json(result.rows[0] || { success: true });
  } catch (err) {
    res.json({ success: true, bypassed: true });
  }
});

// ─── STORIES ──────────────────────────────────────────────────────────────────

app.post('/pipelines/:id/stories', async (req, res) => {
  const { stories } = req.body;
  try {
    await pool.query('DELETE FROM stories WHERE pipeline_id = $1', [req.params.id]);
    for (const s of stories) {
      await pool.query(
        `INSERT INTO stories (id, pipeline_id, title, description, acceptance_criteria,
          story_points, adjusted_points, qa_scenarios, risk_flags, solution, dependencies, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title, description=EXCLUDED.description,
           acceptance_criteria=EXCLUDED.acceptance_criteria,
           adjusted_points=EXCLUDED.adjusted_points, status=EXCLUDED.status`,
        [s.id, req.params.id, s.title, s.description,
          JSON.stringify(s.acceptanceCriteria || []),
          s.storyPoints || 5, s.adjustedPoints || 5,
          JSON.stringify(s.qaScenarios || []),
          JSON.stringify(s.riskFlags || []),
          JSON.stringify(s.solution || {}),
          JSON.stringify(s.dependencies || []),
          s.status || 'pending']
      );
    }
    await pool.query(
      'UPDATE pipeline_runs SET story_count=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [stories.length, 'review', req.params.id]
    );
    res.json({ saved: stories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/pipelines/:pipelineId/stories/:storyId', async (req, res) => {
  const { status, jiraKey, bbBranch, approvedAt } = req.body;
  try {
    await safeQuery(
      `UPDATE stories SET
        status = COALESCE($1, status),
        jira_key = COALESCE($2, jira_key),
        bb_branch = COALESCE($3, bb_branch),
        approved_at = COALESCE($4, approved_at)
       WHERE id = $5 AND pipeline_id = $6`,
      [status, jiraKey, bbBranch, approvedAt, req.params.storyId, req.params.pipelineId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true, bypassed: true });
  }
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

app.post('/pipelines/:id/audit', async (req, res) => {
  const { eventType, eventData } = req.body;
  try {
    const result = await safeQuery(
      'INSERT INTO audit_log (pipeline_id, event_type, event_data) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, eventType, JSON.stringify(eventData || {})]
    );
    res.json(result.rows[0] || { ok: true });
  } catch (err) {
    res.json({ ok: true, bypassed: true });
  }
});

// ─── PR CHECKLIST GENERATION ──────────────────────────────────────────────────

app.post('/generate-pr-checklist', async (req, res) => {
  const { story } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });

  const prompt = `You are an expert software engineer. Generate a concise PR review checklist for the following user story.

Story: ${story.title}
Description: ${story.description}
Acceptance Criteria:
${(story.acceptanceCriteria || []).map(ac => `- ${ac}`).join('\n')}
Story Points: ${story.adjustedPoints}
Risk Flags: ${(story.riskFlags || []).map(r => r.text).join(', ') || 'None'}

Generate a PR review checklist in markdown format with these sections:
## Code Quality
## Test Coverage
## Acceptance Criteria Verification
## Security & Performance
## Documentation

Each section should have 2-4 checkbox items relevant to this story.
Return ONLY the markdown checklist. No preamble.`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.2);
    const checklist = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ checklist });
  } catch (err) {
    console.error('PR checklist error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── STAKEHOLDER EMAIL GENERATION ─────────────────────────────────────────────

app.post('/generate-stakeholder-email', async (req, res) => {
  const { stories, projectName } = req.body;
  if (!stories || !stories.length) return res.status(400).json({ error: 'No stories provided' });

  const totalPoints = stories.reduce((sum, s) => sum + (s.adjustedPoints || 0), 0);
  const riskyStories = stories.filter(s => (s.riskFlags || []).length > 0);

  const prompt = `You are a TPM writing a stakeholder sprint update email. Write a clear, non-technical plain-English summary.

Project: ${projectName || 'Sprint Planning'}
Total Stories: ${stories.length}
Total Story Points: ${totalPoints}

Stories:
${stories.map(s => `- ${s.title} (${s.adjustedPoints} pts)${(s.riskFlags || []).length > 0 ? ' ⚠️' : ''}`).join('\n')}

Risks Identified:
${riskyStories.length > 0 ? riskyStories.flatMap(s => s.riskFlags || []).map(r => `- ${r.text}`).join('\n') : 'None'}

Write a professional stakeholder email with:
1. Subject line
2. Brief overview (2-3 sentences)
3. What's being built (bulleted feature list, business language)
4. Risks & mitigation if any
5. Next steps and who to contact

Format exactly as:
SUBJECT: [subject line]
BODY:
[email body]`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.3);
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    const subjectMatch = content.match(/SUBJECT:\s*(.+)/i);
    const bodyMatch = content.match(/BODY:\s*([\s\S]+)/i);

    res.json({
      subject: subjectMatch?.[1]?.trim() || `Sprint Update: ${stories.length} stories, ${totalPoints} pts`,
      body: bodyMatch?.[1]?.trim() || content
    });
  } catch (err) {
    console.error('Email generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SLACK / TEAMS WEBHOOK NOTIFICATION ───────────────────────────────────────

app.post('/notify-slack', async (req, res) => {
  const { webhookUrl, message } = req.body;
  if (!webhookUrl || !message) return res.status(400).json({ error: 'webhookUrl and message required' });

  const allowed = [
    'https://hooks.slack.com/',
    'https://outlook.office.com/webhook/',
    'https://discord.com/api/webhooks/'
  ];
  if (!allowed.some(prefix => webhookUrl.startsWith(prefix))) {
    return res.status(400).json({ error: 'Only Slack, Teams, and Discord webhooks are supported.' });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (response.ok) {
      res.json({ success: true });
    } else {
      const text = await response.text();
      res.status(400).json({ success: false, error: text });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CODE GENERATION ─────────────────────────────────────────────────────────

app.post('/generate-code', async (req, res) => {
  const { story, repoContext } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });

  const repoStructure = repoContext?.structure || 'Repository structure not available.';
  const existingFiles = (repoContext?.files || [])
    .map(f => `### ${f.path}\n\`\`\`${f.language || ''}\n${f.content.slice(0, 1500)}\n\`\`\``)
    .join('\n\n');

  const prompt = `You are a senior software engineer. Generate production-ready code scaffolding for the following user story, following the exact patterns and conventions of the existing codebase.

Story: ${story.title}
Description: ${story.description}
Technical Notes: ${story.technicalNotes || 'None'}
Labels: ${(story.labels || []).join(', ') || 'None'}
Priority: ${story.priority || 'Medium'}

Positive Acceptance Criteria:
${(story.acceptanceCriteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n') || 'None'}

Negative Acceptance Criteria:
${(story.negativeAcceptanceCriteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n') || 'None'}

Existing Repository Structure:
${repoStructure}

Key Existing Files (for style and convention reference):
${existingFiles || 'No existing files available — infer a sensible structure.'}

Generate code files following the existing codebase conventions. Respond with a JSON object:
{
  "summary": "1-2 sentence description of what was generated",
  "files": [
    {
      "path": "relative/path/to/file.js",
      "language": "javascript",
      "purpose": "One sentence role of this file",
      "content": "full file content with TODO comments for business logic"
    }
  ]
}

Rules:
- Match naming conventions, import styles, folder structure from the existing files exactly
- Generate 2-5 files (service, controller/handler, model/schema, test stub as applicable)
- Use TODO comments where business logic must be implemented
- Include proper error handling patterns matching existing code
- Generate unit test stubs if test files exist in the repo

Respond with ONLY a valid JSON object. No markdown wrapper, no explanation.`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.2);

    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse AI response', raw: content });

    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error('Code generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SOLUTIONING DOCUMENT GENERATION ─────────────────────────────────────────

app.post('/generate-solutioning-doc', async (req, res) => {
  const { stories, repoContext, projectName } = req.body;
  if (!stories?.length) return res.status(400).json({ error: 'No stories provided' });

  const repoStructure = repoContext?.structure || 'Repository structure not available.';
  const existingFiles = (repoContext?.files || [])
    .map(f => `### ${f.path}\n\`\`\`${f.language || ''}\n${f.content.slice(0, 1000)}\n\`\`\``)
    .join('\n\n');

  const storiesSummary = stories.map(s => `
**${s.title}** (${s.adjustedPoints} pts · ${s.priority || 'Medium'} priority)
Description: ${s.description}
Technical Notes: ${s.technicalNotes || 'None'}
Labels: ${(s.labels || []).join(', ') || 'None'}
Positive AC: ${(s.acceptanceCriteria || []).join(' | ')}
Negative AC: ${(s.negativeAcceptanceCriteria || []).join(' | ')}
Risks: ${(s.riskFlags || []).map(r => r.text).join(', ') || 'None'}
`).join('\n---\n');

  const prompt = `You are a senior solutions architect. Generate a detailed, professional technical solutioning document for a development sprint.

Project: ${projectName || 'Sprint'}
Total Stories: ${stories.length}
Total Story Points: ${stories.reduce((a, s) => a + (s.adjustedPoints || 0), 0)}

Stories:
${storiesSummary}

Existing Repository Structure:
${repoStructure}

Key Existing Files:
${existingFiles || 'Not available — base recommendations on the story context.'}

Write a comprehensive solutioning document using clean Confluence-compatible HTML. Include ALL of these sections:

1. <h2>Executive Summary</h2> — sprint goals, scope, total effort
2. <h2>Current Architecture</h2> — describe what the existing codebase does based on the files, tech stack detected
3. <h2>Per-Story Technical Design</h2> — for each story:
   - Proposed new files / modifications to existing files
   - API contracts (method, path, request body, response)
   - Data model changes
   - Component/module interactions
   - Security considerations specific to this story
   - Performance notes
4. <h2>Cross-Story Integration Points</h2> — shared services, shared data, execution order
5. <h2>Implementation Roadmap</h2> — suggested order to implement stories with rationale
6. <h2>Risk Register</h2> — HTML table with: Risk | Likelihood | Impact | Mitigation
7. <h2>Testing Strategy</h2> — unit, integration, E2E approach per story

Use: h1, h2, h3, p, ul, li, ol, table, thead, tbody, tr, th, td, code, pre, strong, em.
Do NOT use Confluence macros or custom XML. Keep it clean semantic HTML.
Start the document with: <h1>${projectName || 'Sprint'} – Technical Solutioning Document</h1>

Respond with ONLY the HTML string. No markdown, no code fences, no explanation.`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.3);
    const html = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ html });
  } catch (err) {
    console.error('Solutioning doc error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── QA TEST CASE GENERATION ─────────────────────────────────────────────────

app.post('/generate-qa-tasks', async (req, res) => {
  const { story } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });

  const acPositive = (story.acceptanceCriteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n');
  const acNegative = (story.negativeAcceptanceCriteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n');

  const prompt = `You are a senior QA engineer. Generate comprehensive, structured test cases for the following user story.

Story: ${story.title}
Description: ${story.description}

Positive Acceptance Criteria:
${acPositive || 'None provided'}

Negative Acceptance Criteria:
${acNegative || 'None provided'}

Risk Flags: ${(story.riskFlags || []).map(r => r.text).join(', ') || 'None'}
Story Points: ${story.adjustedPoints || story.storyPoints || 3}

Generate test cases as a JSON array. Each test case must have:
- id: "TC-001", "TC-002", etc.
- title: short, action-oriented test case title
- type: "Positive" | "Negative" | "Edge Case" | "Performance" | "Security"
- priority: "Critical" | "High" | "Medium" | "Low"
- preconditions: string describing setup state (e.g. "User is logged in and has admin role")
- steps: array of numbered step strings (e.g. ["Navigate to the settings page", "Click on 'Save' button"])
- expectedResult: string describing the exact expected outcome
- relatedAC: index of the acceptance criterion this covers (1-based), or null

Rules:
- Generate test cases for EVERY positive and negative acceptance criterion
- Add edge cases for boundary values, empty inputs, special characters where relevant
- Add security test cases if story involves auth, permissions, or user data
- Priority "Critical" = core happy path; "High" = main negative paths; "Medium" = edge cases
- Minimum 4 test cases, maximum 12

Respond with ONLY a valid JSON array. No markdown, no explanation.`;

  try {
    const data = await callAI(AI_MODEL, [{ role: 'user', content: prompt }], 0.2);
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse AI response', raw: content });

    const testCases = JSON.parse(jsonMatch[0]);
    res.json({ testCases });
  } catch (err) {
    console.error('QA task generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await safeQuery('SELECT 1');
    res.json({ status: 'ok', db: pool ? 'connected' : 'disabled' });
  } catch {
    res.json({ status: 'ok', db: 'error' }); // Return ok so UI doesn't crash if DB fails locally
  }
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────

app.post('/update-env', (req, res) => {
  const { atlassianToken, bitbucketToken, aiToken } = req.body;
  if (!atlassianToken && !bitbucketToken && !aiToken) {
    return res.status(400).json({ error: 'No tokens provided' });
  }

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    if (atlassianToken) {
      if (envContent.includes('ATLASSIAN_API_TOKEN=')) {
        envContent = envContent.replace(/ATLASSIAN_API_TOKEN=.*/, `ATLASSIAN_API_TOKEN=${atlassianToken}`);
      } else {
        envContent += `\nATLASSIAN_API_TOKEN=${atlassianToken}`;
      }
    }

    if (bitbucketToken) {
      if (envContent.includes('BITBUCKET_API_TOKEN=')) {
        envContent = envContent.replace(/BITBUCKET_API_TOKEN=.*/, `BITBUCKET_API_TOKEN=${bitbucketToken}`);
      } else {
        envContent += `\nBITBUCKET_API_TOKEN=${bitbucketToken}`;
      }
    }

    if (aiToken) {
      if (envContent.includes('OPENROUTER_API_KEY=')) {
        envContent = envContent.replace(/OPENROUTER_API_KEY=.*/, `OPENROUTER_API_KEY=${aiToken}`);
      } else {
        envContent += `\nOPENROUTER_API_KEY=${aiToken}`;
      }
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to write .env file:', err);
    res.status(500).json({ error: 'Failed to update environment configuration' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SDLC Autopilot backend running on http://0.0.0.0:${PORT}`);
});

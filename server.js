import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── AI EXTRACTION ────────────────────────────────────────────────────────────

app.post('/extract', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const prompt = `You are a senior Technical Program Manager and product engineer with 10+ years of experience writing Jira stories for enterprise teams. Your job is to analyse a meeting transcript and extract every distinct feature, requirement, or decision into structured user stories suitable for direct import into Jira.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a raw JSON array. No markdown code fences (\`\`\`). No explanatory text before or after. No "Here is the output:" preamble. The very first character of your response must be "[" and the very last must be "]".

Even if only one story is found, wrap it in an array: [{ ... }]
If the transcript is extremely short or vague, infer a reasonable story from whatever context is present — do not return an empty array.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED FIELDS — every story object must contain ALL of these
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"id"                    : string  — sequential identifier: "story-1", "story-2", … "story-N"
"title"                 : string  — concise, action-oriented title (max 80 characters, no punctuation at end)
"description"           : string  — strict format: "As a [specific persona], I want to [concrete action] so that [measurable benefit]"
"acceptanceCriteria"    : array   — 3 to 5 strings, each a POSITIVE criterion (happy path / success case)
                                    • Write in plain English, not Gherkin
                                    • Must be testable and specific — e.g. "User receives a confirmation email within 60 seconds of registration"
                                    • Bad example (too vague): "Feature works correctly"
"negativeAcceptanceCriteria" : array — 2 to 4 strings, each a NEGATIVE criterion (failure, edge-case, or access-control scenario)
                                    • MUST follow Given/When/Then format: "Given [precondition], When [action], Then [expected failure behaviour]"
                                    • Must cover: at least one auth/permission case, at least one invalid-input case
                                    • Example: "Given an unauthenticated user, When they call POST /api/orders, Then the API returns HTTP 401 Unauthorized with error code AUTH_REQUIRED"
                                    • Bad example (too vague): "Invalid data is rejected"
"storyPoints"           : number  — Fibonacci: 1 | 2 | 3 | 5 | 8 | 13 — estimate effort, not complexity alone
"adjustedPoints"        : number  — start identical to storyPoints; team adjusts later
"priority"              : string  — exactly one of: "High" | "Medium" | "Low"
                                    • High = blocks other work, customer-facing, revenue impact
                                    • Medium = important but not blocking
                                    • Low = nice-to-have, internal tooling, cleanup
"labels"                : array   — 1 to 3 lowercase strings from this set (pick closest matches):
                                    "api" | "auth" | "frontend" | "backend" | "database" | "payments" | "notifications" | "reporting" | "search" | "infrastructure" | "security" | "performance" | "data-migration" | "third-party" | "mobile" | "testing"
"technicalNotes"        : string  — 1 to 3 sentences written FOR THE DEVELOPER (not the PM). Include:
                                    • Suggested implementation approach or key library/pattern to use
                                    • Any important constraints, gotchas, or coupling with existing systems
                                    • Data storage or API design hints if apparent from context
                                    • Do NOT repeat acceptance criteria — add new engineering context
"qaScenarios"           : array   — 2 to 3 COMPLETE Gherkin scenario strings. Each must be a self-contained multi-line string with this exact structure:
                                    "Feature: <feature name>\\n\\n  Scenario: <scenario title>\\n    Given <precondition>\\n    When <action>\\n    Then <outcome>"
                                    Cover: 1 happy-path scenario + 1 failure scenario minimum
"riskFlags"             : array   — 0 to 4 risk objects. Each object MUST have exactly these three keys:
                                    { "id": "r-1", "type": "warning" | "error", "text": "<concise risk description>" }
                                    • "error" = blocker-level risk (security flaw, data loss risk, external dependency with no fallback)
                                    • "warning" = notable concern (performance, scope creep, unclear requirement)
                                    • Do NOT include strings — only objects with id/type/text
                                    • If no meaningful risks exist, return []
"solution"              : object  — { "options": [ <1 to 2 option objects> ] }
                                    Each option: { "id": "opt-1", "name": "<approach name>", "description": "<2-3 sentence technical description>", "pros": ["<pro>", ...], "cons": ["<con>", ...], "complexity": "Low" | "Medium" | "High", "recommended": true | false }
                                    Exactly one option must have recommended: true
"dependencies"          : array   — list of story id strings this story depends on (e.g. ["story-1"]). Use [] if none.
"status"                : string  — always "pending"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Extract 1 to 6 stories. Each story must represent one distinct, independently-deliverable feature or requirement.
2. If the transcript mentions the same feature multiple ways, merge them into one story — do not duplicate.
3. If the transcript is vague, short, or ambiguous, still produce at least 1 story using whatever context is available. Infer a sensible persona, action, and benefit from the topic.
4. Do NOT invent features not implied by the transcript.
5. Identify which stories must be completed before others can start — populate "dependencies" accordingly.
6. Flag as "High" priority any story that: blocks other stories, is described as urgent, is customer-facing with revenue impact, or involves security/auth.
7. Risk detection keywords: performance, latency, SLA, scale, millions of records, external API, third-party, migration, deadline, breaking change, security, GDPR, PII, cost, budget, unclear, TBD, to be decided.
8. Every riskFlag must be a JSON object {id, type, text} — never a plain string.
9. qaScenarios must be complete Gherkin strings, not just scenario titles.
10. technicalNotes must be developer-facing — mention frameworks, patterns, data models, API contracts, or coupling concerns.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE — one well-formed story object (for schema reference only)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "id": "story-1",
  "title": "User registration with email verification",
  "description": "As a new user, I want to register with my email and receive a verification link so that my account is confirmed and secure before first login.",
  "acceptanceCriteria": [
    "User can submit registration form with name, email, and password",
    "System sends a verification email within 60 seconds of form submission",
    "User can click the verification link to activate their account",
    "Registration is rejected and error shown if email is already in use"
  ],
  "negativeAcceptanceCriteria": [
    "Given a user submits a registration form with an already-registered email, When the form is submitted, Then the system returns HTTP 409 with error message 'Email already in use'",
    "Given a user submits an expired verification link (>24 hours old), When they click the link, Then they are shown an error page with a 'Resend verification email' option",
    "Given an unauthenticated request to POST /api/users, When the request body is missing the 'email' field, Then the API returns HTTP 400 with field-level validation errors"
  ],
  "storyPoints": 5,
  "adjustedPoints": 5,
  "priority": "High",
  "labels": ["auth", "backend", "notifications"],
  "technicalNotes": "Use bcrypt (cost factor 12) for password hashing. Verification tokens should be JWT with 24-hour expiry stored in Redis for revocation support. Email sending via SendGrid; wrap in a queue (BullMQ or SQS) to handle retries without blocking the HTTP response.",
  "qaScenarios": [
    "Feature: User Registration\\n\\n  Scenario: Successful registration and email verification\\n    Given a new user with a unique email address\\n    When they submit the registration form with valid name, email, and password\\n    Then they receive a 201 response\\n    And a verification email is delivered within 60 seconds\\n    And their account status is 'pending_verification'",
    "Feature: User Registration\\n\\n  Scenario: Registration with duplicate email\\n    Given an existing user with email 'jane@example.com'\\n    When a new user attempts to register with 'jane@example.com'\\n    Then the system returns HTTP 409\\n    And the response body contains error code 'EMAIL_IN_USE'\\n    And no verification email is sent"
  ],
  "riskFlags": [
    { "id": "r-1", "type": "warning", "text": "Email deliverability depends on SendGrid domain verification — ensure SPF/DKIM records are configured before go-live" },
    { "id": "r-2", "type": "error", "text": "Password reset flow is not in scope for this story but shares the token infrastructure — coordinate with the auth team to avoid design conflicts" }
  ],
  "solution": {
    "options": [
      {
        "id": "opt-1",
        "name": "JWT tokens + Redis revocation store",
        "description": "Generate a signed JWT as the verification token. Store the token ID in Redis with a 24-hour TTL so tokens can be invalidated server-side on use or expiry. Simple to implement with existing JWT libraries and provides instant revocation capability.",
        "pros": ["Stateless verification reduces DB load", "Easy to revoke tokens via Redis delete", "JWT payload carries user context without extra DB lookup"],
        "cons": ["Requires Redis infrastructure", "JWT size is larger than a random token"],
        "complexity": "Medium",
        "recommended": true
      }
    ]
  },
  "dependencies": [],
  "status": "pending"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRANSCRIPT TO ANALYSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${text.slice(0, 28000)}`;

  // gpt-4o-mini context window is 128k tokens; 16000 output tokens gives ample room for 10+ stories
  const MAX_OUTPUT_TOKENS = 16000;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: MAX_OUTPUT_TOKENS
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(`[extract] finish_reason=${finishReason} tokens_used=${JSON.stringify(data.usage)}`);

    if (finishReason === 'length') {
      console.warn('[extract] Model hit max_tokens limit — response may be truncated. Consider splitting the transcript.');
    }

    // Strip markdown code fences if the model wrapped the JSON despite instructions
    const content = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let stories;
    try {
      // Try direct parse first (ideal — model returned clean JSON)
      const parsed = JSON.parse(content);
      stories = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Fallback 1: extract the first JSON array via greedy regex
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          stories = JSON.parse(jsonMatch[0]);
          if (!Array.isArray(stories)) stories = [stories];
        } catch {}
      }

      // Fallback 2: the model was cut off mid-JSON — try to recover truncated objects
      if (!stories) {
        // Find where the array starts and try to extract complete objects before truncation
        const arrayStart = content.indexOf('[');
        if (arrayStart !== -1) {
          const partial = content.slice(arrayStart);
          // Extract individual story objects using a balanced-brace parser
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
            console.warn(`[extract] Recovered ${recovered.length} complete story objects from truncated response.`);
            stories = recovered;
          }
        }
      }

      if (!stories) {
        console.error('No JSON array found in response:', content.slice(0, 500));
        return res.status(500).json({ error: 'Could not parse AI response', raw: rawContent.slice(0, 2000) });
      }
    }

    if (!stories || stories.length === 0) {
      console.warn('AI returned empty stories array — model response:', content.slice(0, 500));
      return res.status(422).json({ error: 'AI returned no stories. The transcript may be too short or unclear. Please add more detail and try again.' });
    }

    const truncated = finishReason === 'length';
    res.json({ stories, model: data.model, usage: data.usage, truncated });
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 3000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Transcript cleanup error:', err);
      return res.json({ cleaned: rawTranscript, fallback: true });
    }

    const data = await response.json();
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
    const result = await pool.query(
      'SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 20'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/pipelines', async (req, res) => {
  const { fileNames, transcriptSummary } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO pipeline_runs (file_names, transcript_summary, status)
       VALUES ($1, $2, 'extracting') RETURNING *`,
      [JSON.stringify(fileNames || []), transcriptSummary || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/pipelines/:id', async (req, res) => {
  try {
    const pipeline = await pool.query('SELECT * FROM pipeline_runs WHERE id = $1', [req.params.id]);
    const stories = await pool.query('SELECT * FROM stories WHERE pipeline_id = $1', [req.params.id]);
    const audit = await pool.query('SELECT * FROM audit_log WHERE pipeline_id = $1 ORDER BY created_at', [req.params.id]);
    if (!pipeline.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ...pipeline.rows[0], stories: stories.rows, audit: audit.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/pipelines/:id', async (req, res) => {
  const { status, storyCount, approvedCount, jiraKeys, confluenceUrl, notes } = req.body;
  try {
    const result = await pool.query(
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
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    await pool.query(
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
    res.status(500).json({ error: err.message });
  }
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

app.post('/pipelines/:id/audit', async (req, res) => {
  const { eventType, eventData } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO audit_log (pipeline_id, event_type, event_data) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, eventType, JSON.stringify(eventData || {})]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sdlc-autopilot.replit.app',
        'X-Title': 'SDLC Autopilot'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2500
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
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
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SDLC Autopilot backend running on http://0.0.0.0:${PORT}`);
});

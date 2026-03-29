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

  const prompt = `You are an expert TPM/PM AI assistant. Analyze the following meeting transcript(s) and extract well-structured Jira stories.

For each story you identify, output a JSON object with these exact fields:
- id: string like "story-1", "story-2", etc.
- title: concise story title (max 80 chars)
- description: "As a [persona], I want to [action] so that [benefit]" format
- acceptanceCriteria: array of 3-5 POSITIVE acceptance criteria — happy-path, expected behaviour when everything works correctly
- negativeAcceptanceCriteria: array of 2-4 NEGATIVE acceptance criteria — error handling, invalid inputs, edge cases, access control, boundary conditions (e.g. "Given an unauthenticated user, When they access the endpoint, Then a 401 is returned")
- storyPoints: estimated story points (fibonacci: 1, 2, 3, 5, 8, 13)
- adjustedPoints: same as storyPoints initially
- priority: "High" | "Medium" | "Low" — based on business impact, user value, and risk
- labels: array of 1-3 concise lowercase technical tags relevant to the story (e.g. ["api", "auth", "frontend", "database", "payments", "notifications"])
- technicalNotes: 1-2 sentence string describing key implementation considerations, suggested approach, or important constraints the developer should know
- qaScenarios: array of 2-3 complete Gherkin scenario strings (Feature/Scenario/Given/When/Then) covering the most critical positive and negative paths
- riskFlags: array of objects {id, type ("warning"|"error"), text} for identified risks
- solution: {options: [{id, name, description, pros (array), cons (array), complexity ("Low"|"Medium"|"High"), recommended (bool)}]} - include 1-2 technical solution options
- dependencies: array of story ids this story depends on (can be empty [])
- status: "pending"

Rules:
- Extract 2-6 stories, each representing a distinct feature or requirement
- Merge duplicate/overlapping requirements into single stories
- Flag risks using words like: performance, security, scale, dependency, external API, migration, deadline, cost
- Identify natural dependencies between stories
- Make descriptions specific and actionable
- Negative acceptance criteria must be testable and specific — not generic statements

Respond with ONLY a valid JSON array of story objects. No markdown, no explanation, just the JSON array.

TRANSCRIPT:
${text.slice(0, 12000)}`;

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
      console.error('OpenRouter error:', err);
      return res.status(500).json({ error: 'AI service error', detail: err });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('No JSON array found in response:', content);
      return res.status(500).json({ error: 'Could not parse AI response', raw: content });
    }

    const stories = JSON.parse(jsonMatch[0]);
    res.json({ stories, model: data.model, usage: data.usage });
  } catch (err) {
    console.error('Extraction error:', err);
    res.status(500).json({ error: err.message });
  }
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

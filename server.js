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
  const { text, fileNames = [] } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const prompt = `You are an expert TPM/PM AI assistant. Analyze the following meeting transcript(s) and extract well-structured Jira stories.

For each story you identify, output a JSON object with these exact fields:
- id: string like "story-1", "story-2", etc.
- title: concise story title (max 80 chars)
- description: "As a [persona], I want to [action] so that [benefit]" format
- acceptanceCriteria: array of 3-5 clear, testable acceptance criteria strings
- storyPoints: estimated story points (fibonacci: 1, 2, 3, 5, 8, 13)
- adjustedPoints: same as storyPoints initially
- qaScenarios: array of 2-3 Gherkin scenario strings (Feature/Scenario/Given/When/Then)
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

// ─── PIPELINE RUNS ────────────────────────────────────────────────────────────

app.get('/pipelines', async (req, res) => {
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

// ─── HEALTH ───────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
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

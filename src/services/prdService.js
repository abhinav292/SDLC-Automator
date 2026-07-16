import { generatePRD as generatePRDApi } from './apiService';

// Local skeleton used when the AI backend is unavailable, mirroring the
// localExtract fallback in extractionService so the PRD phase never hard-blocks.
const buildLocalPRD = (source, projectName) => {
  const text = (source || '').replace(/\r/g, '').trim();
  const firstLine = text.split('\n').find(l => l.trim())?.trim().slice(0, 80) || 'Product';
  const name = projectName || firstLine;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20)
    .slice(0, 8);

  const bullets = sentences.length
    ? sentences.map(s => `- ${s.slice(0, 200)}`).join('\n')
    : '- _To be determined._';
  const overview = sentences.slice(0, 2).join(' ') || '_To be determined._';

  return `# ${name}

## 1. Overview
${overview}

## 2. Problem Statement
- _Derived from the notes below — refine as needed._

## 3. Goals & Objectives
${bullets}

## 4. Non-Goals
- _To be determined._

## 5. Target Users & Personas
- _To be determined._

## 6. User Stories
- _To be determined._

## 7. Functional Requirements
${bullets}

## 8. Non-Functional Requirements
- _To be determined._

## 9. Success Metrics
- _To be determined._

## 10. Risks & Assumptions
- _To be determined._

## 11. Open Questions
- _To be determined._

---
> ⚠️ AI generation was unavailable, so this is a local draft built from your source. Please edit it before generating Jira tickets.`;
};

// Returns { prd, fallback }. Never throws — always yields an editable draft.
export const generatePRDDoc = async (source, projectName) => {
  try {
    const { prd } = await generatePRDApi(source, projectName);
    if (prd && prd.trim()) return { prd, fallback: false };
    return { prd: buildLocalPRD(source, projectName), fallback: true };
  } catch (err) {
    console.warn('PRD AI generation failed, using local skeleton:', err.message);
    return { prd: buildLocalPRD(source, projectName), fallback: true };
  }
};

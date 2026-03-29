export const mockStories = [
  {
    id: 'story-1',
    title: 'Implement Multi-Transcript Upload UI',
    description: 'As a TPM/PM, I want to be able to drag-and-drop or select multiple transcript files (.txt, .docx, .pdf) simultaneously so that I can process meetings in batch.',
    acceptanceCriteria: [
      'UI must accept .txt, .docx, and .pdf files.',
      'A progress indicator must show the upload status for each individual file.',
      'User must see standard validation errors for unsupported file types or sizes > 50MB.',
      'After all files upload, the system should allow proceeding to the extraction phase.'
    ],
    storyPoints: 5,
    adjustedPoints: 8,
    qaScenarios: [
      'Scenario: Uploading valid files\nGiven I am on the upload page\nWhen I drag 3 valid txt files\nThen they should upload successfully and enable "Process".',
      'Scenario: Invalid file type\nWhen I upload an .exe file\nThen I get a validation error.'
    ],
    riskFlags: [
      { id: 'r1', type: 'warning', text: 'Large files might cause Bedrock timeout if chunking logic is unoptimized.' }
    ],
    solution: {
      options: [
        {
          id: 'opt-1',
          name: 'React Dropzone + Multipart S3 Upload',
          description: 'Use react-dropzone on the frontend to handle file management and display. Stream directly to S3 via pre-signed URLs.',
          pros: ['Scalable for large files', 'Offloads backend traffic'],
          cons: ['Requires complex S3 CORS setup', 'Slightly more frontend logic'],
          complexity: 'Medium',
          recommended: true
        },
        {
          id: 'opt-2',
          name: 'Lambda Proxy Upload',
          description: 'Send API Gateway Base64 encoded payloads to Lambda, which writes to S3.',
          pros: ['Simple architecture'],
          cons: ['10MB API Gateway hard limit', 'Higher invocation costs'],
          complexity: 'Low',
          recommended: false
        }
      ]
    },
    dependencies: []
  },
  {
    id: 'story-2',
    title: 'AI Extraction Pipeline Integration',
    description: 'As a TPM/PM, I want the system to pass the extracted transcript text to Amazon Bedrock (Claude 3.5 Sonnet) to synthesize and deduplicate requirements into discrete stories.',
    acceptanceCriteria: [
      'System must chunk text if it exceeds token limits.',
      'Bedrock prompt must be configured to output JSON formatted stories.',
      'In the case of duplicate topics, the prompt must merge them into a single coherent story.'
    ],
    storyPoints: 8,
    adjustedPoints: 8,
    qaScenarios: [
      'Scenario: Duplicate meeting notes\nGiven multiple transcripts contain the same feature request\nWhen extracted\nThen only one story is created with all context.'
    ],
    riskFlags: [
      { id: 'r2', type: 'error', text: 'Dependency on AWS API quota; potential rate limits.' },
      { id: 'r3', type: 'warning', text: 'Cost per token might spike for 1hr+ transcripts.' }
    ],
    solution: {
      options: [
        {
          id: 'opt-1',
          name: 'Step Functions + Bedrock Lambda SDK',
          description: 'Orchestrate the ingestion, chunking, AI extraction, and DB persisting via Step Functions.',
          pros: ['Resilient to timeouts', 'Visual debugging', 'Easy to add Human-in-the-loop'],
          cons: ['State machine complexity'],
          complexity: 'High',
          recommended: true
        }
      ]
    },
    dependencies: ['story-1']
  },
  {
    id: 'story-3',
    title: 'Review Checkpoint Dashboard UX',
    description: 'As a TPM/PM, I want a visual interface to review, edit, approve, or discard the AI-generated stories prior to creating Jira or Bitbucket artifacts.',
    acceptanceCriteria: [
      'Dashboard must show all stories generated in cards.',
      'User can edit title, description, and ACs inline.',
      'User must approve each story.',
      'Risk flags must be visually highlighted in red/yellow.'
    ],
    storyPoints: 5,
    adjustedPoints: 3,
    qaScenarios: [
      'Scenario: Editing a generated story\nWhen I click on the description of a story card\nThen it becomes editable and saves securely.'
    ],
    riskFlags: [],
    solution: {
      options: [
        {
          id: 'opt-1',
          name: 'React Context State + Formik',
          description: 'Store extracted stories in context. Use controlled inputs for inline editing.',
          pros: ['Smooth UX without redundant API calls'],
          cons: ['Data loss risk if tab is closed without save'],
          complexity: 'Low',
          recommended: true
        }
      ]
    },
    dependencies: ['story-2']
  }
];

export const mockProjectStats = {
  pipelineRuns: 24,
  storiesPushed: 89,
  timeSaved: "142 hrs",
  accuracy: "94%"
};

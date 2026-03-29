import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle, Loader2, Link, FileText, CheckSquare, 
  GitBranch, AlignLeft, Send
} from 'lucide-react';
import { mockStories } from '../mocks';
import './Handoff.css';

export const Handoff = () => {
  const navigate = useNavigate();
  const [syncStep, setSyncStep] = useState(0);
  const [createdJiraIssues, setCreatedJiraIssues] = useState({});

  useEffect(() => {
    const doSync = async () => {
      try {
        setSyncStep(0); // Connecting
        await new Promise(r => setTimeout(r, 1000));
        
        setSyncStep(1); // Jira
        const newIssues = {};
        for (const story of mockStories) {
          const reqBody = {
            fields: {
              project: { key: import.meta.env.VITE_ATLASSIAN_PROJECT_KEY || "KAN" },
              summary: story.title,
              description: {
                type: "doc",
                version: 1,
                content: [
                  { type: "paragraph", content: [{ type: "text", text: story.description }] }
                ]
              },
              issuetype: { name: "Story" },
            }
          };

          try {
            const res = await fetch('/api/jira/issue', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'X-Atlassian-Token': 'no-check'
              },
              body: JSON.stringify(reqBody)
            });
            const data = await res.json();
            if (res.ok) {
              newIssues[story.id] = data.key;
            } else {
              console.error("Jira error:", data);
              newIssues[story.id] = "ERR";
            }
          } catch(e) {
            console.error("Fetch error:", e);
            newIssues[story.id] = "ERR";
          }
        }
        setCreatedJiraIssues(newIssues);
        
        // Simulating the remaining steps
        await new Promise(r => setTimeout(r, 2000));
        setSyncStep(2); // Bitbucket
        await new Promise(r => setTimeout(r, 2000));
        setSyncStep(3); // Confluence
        await new Promise(r => setTimeout(r, 2000));
        setSyncStep(4); // Done
      } catch (err) {
        console.error(err);
      }
    };
    doSync();
  }, []);

  return (
    <div className="handoff-dashboard">
      <header className="mb-10 text-center">
        {syncStep < 4 ? (
          <>
            <div className="flex justify-center mb-6">
              <Loader2 size={64} className="animate-spin text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Publishing Artifacts...</h1>
            <p className="text-secondary min-h-[24px]">
              {syncStep === 0 && "Connecting to toolchain..."}
              {syncStep === 1 && "Creating Jira issues and mapping dependencies..."}
              {syncStep === 2 && "Scaffolding Bitbucket branches and generating review checklists..."}
              {syncStep === 3 && "Publishing Confluence documentation and notifying stakeholders..."}
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center animate-fade-in">
                <CheckCircle size={48} className="text-success" />
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-2 animate-fade-in">Sync Complete!</h1>
            <p className="text-secondary animate-fade-in">All artifacts successfully published across your toolchain.</p>
          </>
        )}
      </header>

      <div className="grid grid-cols-3 gap-6 mx-auto max-w-5xl mb-8">
        {/* Jira Integration */}
        {syncStep >= 1 ? (
          <div className="card artifact-card animate-fade-in stagger-1">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <CheckSquare size={24} className="text-blue-500" />
              </div>
              <h2 className="text-xl font-semibold">Jira Stories (3)</h2>
            </div>
            <div className="flex-col gap-3">
              {mockStories.map(story => (
                <div key={story.id} className="p-3 border border-subtle bg-surface-elevated rounded flex justify-between items-center group">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-mono text-xs font-bold">
                      {createdJiraIssues[story.id] === "ERR" ? (
                        <span className="text-error">ERROR</span>
                      ) : createdJiraIssues[story.id] ? (
                        <>{createdJiraIssues[story.id]}</>
                      ) : (
                        <span className="animate-pulse text-secondary">Creating...</span>
                      )}
                    </span>
                    <span className="text-sm font-medium line-clamp-1">{story.title}</span>
                  </div>
                  <button className="text-secondary hover:text-primary transition-colors">
                    <Link size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : <div className="card artifact-card opacity-30 border-dashed"></div>}

        {/* Bitbucket Integration */}
        {syncStep >= 2 ? (
          <div className="card artifact-card animate-fade-in stagger-1">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-600/10 rounded-lg">
                <GitBranch size={24} className="text-blue-400" />
              </div>
              <h2 className="text-xl font-semibold">Bitbucket Branches</h2>
            </div>
            <div className="flex-col gap-4">
              <div className="p-4 border border-subtle bg-surface-elevated rounded">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={14} className="text-success" />
                  <span className="text-sm font-semibold">3 Scaffolded Branches</span>
                </div>
                <p className="text-xs text-secondary mt-1">feature/PROJ-XXX-multi-upload</p>
                <p className="text-xs text-secondary mt-1">feature/PROJ-XXX-ai-pipeline</p>
                <p className="text-xs text-secondary mt-1">feature/PROJ-XXX-review-ux</p>
                
                <div className="mt-4 pt-3 border-t border-subtle">
                  <span className="text-xs text-info flex items-center gap-1">
                    <AlignLeft size={12} /> PR Checklists Generated
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : <div className="card artifact-card opacity-30 border-dashed"></div>}

        {/* Confluence & Notifications */}
        {syncStep >= 3 ? (
          <div className="flex-col gap-6 animate-fade-in stagger-1">
            <div className="card artifact-card h-1/2 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-indigo-500/10 rounded-lg">
                  <FileText size={20} className="text-indigo-400" />
                </div>
                <h2 className="text-lg font-semibold">Confluence Sync</h2>
              </div>
              <p className="text-sm text-secondary mb-3">Solutioning document automatically transcribed and published.</p>
              <button className="btn btn-secondary w-full justify-between">
                View Architecture Doc <Link size={14} />
              </button>
            </div>

            <div className="card artifact-card h-1/2 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-purple-500/10 rounded-lg">
                  <Send size={20} className="text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold">Notifications</h2>
              </div>
              <p className="text-sm text-secondary mb-3">Stakeholder summary sent to #engineering-leads and relevant PMs.</p>
              <div className="text-xs text-success flex items-center gap-1">
                <CheckCircle size={12} /> SES Email Delivered
              </div>
            </div>
          </div>
        ) : <div className="flex-col gap-6"><div className="card artifact-card h-1/2 opacity-30 border-dashed"></div><div className="card artifact-card h-1/2 opacity-30 border-dashed"></div></div>}
      </div>

      {syncStep === 4 && (
        <div className="text-center mt-4 animate-fade-in stagger-2">
          <button className="btn btn-primary px-8 py-3" onClick={() => navigate('/')}>
            Return to Dashboard
          </button>
        </div>
      )}
    </div>
  );
};

"use client";
import React, { useState, useEffect } from 'react';
import { init, getStack, getFileName } from 'react-grab/core'; 

// Clean up webpack/RSC file paths
const cleanFilePath = (rawPath: string | null): string | null => {
  if (!rawPath) return null;
  
  let cleaned = rawPath;
  
  // Remove query params
  cleaned = cleaned.split('?')[0];
  
  // Remove various webpack/RSC prefixes
  const prefixes = [
    'about://React/Server/',
    'webpack-internal://',
    '///rsc/./',
    '//rsc/./',
    '/rsc/./',
    'rsc/./',
  ];
  
  for (const prefix of prefixes) {
    if (cleaned.includes(prefix)) {
      cleaned = cleaned.split(prefix).pop() || cleaned;
    }
  }
  
  // Remove leading slashes
  cleaned = cleaned.replace(/^\/+/, '');
  
  return cleaned;
};

// Infer file path from Next.js App Router route
const inferFileFromRoute = (): string => {
  const pathname = window.location.pathname;
  if (pathname === '/') {
    return 'app/page.tsx';
  }
  const route = pathname.slice(1);
  return `app/${route}/page.tsx`;
};

export const CursorOverlay = () => {
  const [active, setActive] = useState(false);
  const [inspectorActive, setInspectorActive] = useState(false);
  const [target, setTarget] = useState<any>(null);
  const [prompt, setPrompt] = useState("");
  const [mounted, setMounted] = useState(false);
  const [grabApi, setGrabApi] = useState<any>(null);

  useEffect(() => {
    setMounted(true);

    const api = init({
      theme: {
        enabled: true,
        hue: 280,
        elementLabel: { backgroundColor: "#000000", textColor: "#ffffff" },
      },
      onElementSelect: async (element: Element) => {
        console.log("🔍 Selected element:", element);
        
        // Use react-grab's built-in utilities to get source info
        const stack = await getStack(element);
        const rawFileName = getFileName(stack);
        let fileName = cleanFilePath(rawFileName);
        
        // Get line number from the first stack frame with source info
        const frameWithSource = stack.find(frame => frame.source !== null);
        let lineNumber = frameWithSource?.source?.lineNumber ?? 0;
        const componentName = frameWithSource?.name ?? element.tagName.toLowerCase();

        console.log("📚 Stack:", stack);
        console.log("📂 Raw file:", rawFileName);
        console.log("📂 Cleaned file:", fileName, "Line:", lineNumber);

        // If no fileName found, use route-based fallback
        if (!fileName) {
          console.log("🖥️ No source info found - using route-based fallback");
          fileName = inferFileFromRoute();
          lineNumber = 0;
          console.log("📂 Inferred file from route:", fileName);
        }

        setTarget({
          fileName,
          lineNumber,
          componentName
        });
        setActive(true);

        api.deactivate(); 
        setInspectorActive(false);
      }
    });

    setGrabApi(api);
    return () => { if (api) api.deactivate(); };
  }, []);

  const toggleInspector = () => {
    if (!grabApi) return;
    if (inspectorActive) {
      grabApi.deactivate();
      setInspectorActive(false);
    } else {
      grabApi.activate();
      setInspectorActive(true);
      setActive(false);
    }
  };

  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  const sendCommand = async () => {
    if(!target || !prompt.trim()) return;
    
    const originalText = prompt;
    setStatus('sending');
    setPrompt("🤖 cursor-agent is editing...");
    
    try {
      console.log("📤 Sending to cursor-agent...");
      const response = await fetch('http://localhost:3333/cursor-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: target.fileName,
          component: target.componentName,
          instruction: originalText
        })
      });
      
      const data = await response.json();
      console.log("📥 Response:", data);
      
      if (data.success) {
        setStatus('success');
        setPrompt("✅ Done! Check the browser for changes.");
        
        setTimeout(() => {
          setActive(false);
          setPrompt("");
          setStatus('idle');
        }, 2000);
      } else {
        // Show error with install hint if CLI not found
        const errorMsg = data.installHint 
          ? `CLI not found. Run: curl https://cursor.com/install -fsS | bash`
          : (data.error || "Unknown error");
        throw new Error(errorMsg);
      }
      
    } catch (e: any) {
      console.error("❌ Error:", e);
      setStatus('error');
      
      // Check if it's a connection error
      const isConnectionError = e.message?.includes('fetch') || e.message?.includes('network');
      const errorMsg = isConnectionError 
        ? "Bridge not running. Start: npx cursor-bridge"
        : e.message || "Something went wrong";
      
      setPrompt(`❌ ${errorMsg}`);
      
      setTimeout(() => {
        setPrompt(originalText);
        setStatus('idle');
      }, 4000);
    }
  };

  if (!mounted) return null;

  return (
    <>
      <div 
        onClick={toggleInspector}
        style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
          background: inspectorActive ? '#22c55e' : 'rgba(0,0,0,0.8)', 
          padding: '10px 16px', borderRadius: '30px',
          border: '1px solid #333', color: 'white', 
          fontSize: '13px', fontFamily: 'sans-serif'
        }}
      >
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%', 
          background: inspectorActive ? 'white' : '#666' 
        }}></div>
        <span>{inspectorActive ? 'Click Element' : 'Enable Agent'}</span>
      </div>

      {active && (
        <div style={{
          position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 99999, 
          background: status === 'success' ? '#052e16' : status === 'error' ? '#450a0a' : '#0a0a0a', 
          padding: '24px', 
          borderRadius: '16px', 
          border: `1px solid ${status === 'success' ? '#22c55e' : status === 'error' ? '#ef4444' : '#333'}`, 
          width: '500px', 
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          color: 'white', fontFamily: 'system-ui, sans-serif',
          transition: 'all 0.2s ease'
        }}>
          <div style={{
            fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', 
            color: status === 'success' ? '#86efac' : '#666', 
            marginBottom: '16px', 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {status === 'sending' && (
                <span style={{ 
                  width: '8px', height: '8px', borderRadius: '50%', 
                  background: '#fbbf24', animation: 'pulse 1s infinite' 
                }}/>
              )}
              Editing {target?.fileName?.split('/').pop()}
            </span>
            <span>Line {target?.lineNumber || '~'}</span>
          </div>
          
          <textarea 
            autoFocus
            rows={2}
            disabled={status === 'sending'}
            style={{
              width: '100%', background: 'transparent', border: 'none', 
              outline: 'none', color: 'white', fontSize: '16px',
              resize: 'none', lineHeight: '1.5',
              opacity: status === 'sending' ? 0.7 : 1
            }}
            placeholder="Describe what you want to change..."
            value={prompt}
            onChange={e => status === 'idle' && setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && status === 'idle' && sendCommand()}
          />
          
          {status === 'idle' && (
            <div style={{ 
              marginTop: '12px', fontSize: '11px', color: '#666',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span>Press Enter to send</span>
              <button 
                onClick={sendCommand}
                style={{
                  background: '#22c55e', color: 'black', border: 'none',
                  padding: '6px 16px', borderRadius: '6px', fontSize: '12px',
                  fontWeight: '600', cursor: 'pointer'
                }}
              >
                Send →
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};
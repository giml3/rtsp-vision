/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { Camera, AlertCircle, FileText, Download, Settings as SettingsIcon, List, Play, StopCircle, RefreshCw, Layers, ShieldCheck, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { analyzeImage } from "./lib/gemini";

// --- Types ---
interface DetectionEvent {
  id: string;
  timestamp: string;
  type: "motion" | "ai_alert" | "system";
  message: string;
  thumbnail?: string;
}

interface CameraConfig {
  source: "webcam" | "rtsp" | "test";
  url: string;
  intervalSeconds: number;
  ollamaUrl: string;
  ollamaModel: string;
  aiPrompt: string;
}

export default function App() {
  const [config, setConfig] = useState<CameraConfig>({
    source: "webcam",
    url: "rtsp://localhost:8554/mystream",
    intervalSeconds: 5,
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "granite4.1:3b",
    aiPrompt: "Analyze this image from my RPI5 dashcam. Briefly describe any significant motion, objects (people, cars, animals) or hazards. Be concise."
  });
  
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [detections, setDetections] = useState<DetectionEvent[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [rtspFrame, setRtspFrame] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Effects ---
  
  useEffect(() => {
    if (isMonitoring && config.source === "webcam") {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(err => {
          addEvent("system", "Failed to access webcam: " + err.message);
          setIsMonitoring(false);
        });
    } else if (!isMonitoring && config.source === "webcam") {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
    }
  }, [isMonitoring, config.source]);

  // RTSP Polling
  useEffect(() => {
    let interval: number;
    if (isMonitoring && config.source === "rtsp") {
      const fetchFrame = async () => {
        try {
          const timestamp = Date.now();
          const response = await axios.get(`/api/snapshot?url=${encodeURIComponent(config.url)}&_=${timestamp}`, {
            responseType: 'blob'
          });
          const reader = new FileReader();
          reader.onloadend = () => {
            setRtspFrame(reader.result as string);
          };
          reader.readAsDataURL(response.data);
        } catch (err) {
          console.error("Failed to fetch RTSP frame", err);
        }
      };

      fetchFrame();
      interval = window.setInterval(fetchFrame, 3000); // Poll every 3s
    } else {
      setRtspFrame(null);
    }
    return () => clearInterval(interval);
  }, [isMonitoring, config.source, config.url]);

  // AI Trigger Interval
  useEffect(() => {
    let interval: number;
    if (isMonitoring) {
      const trigger = () => {
        const source = config.source === "webcam" ? videoRef.current : imgRef.current;
        if (!source) return;

        // Check if source is ready
        let isReady = false;
        if (source instanceof HTMLVideoElement) {
          isReady = source.videoWidth > 0;
        } else if (source instanceof HTMLImageElement) {
          isReady = source.complete && source.naturalWidth > 0;
        }

        if (!isReady) return;

        // Capture frame
        const snapCanvas = document.createElement("canvas");
        if (source instanceof HTMLVideoElement) {
          snapCanvas.width = source.videoWidth;
          snapCanvas.height = source.videoHeight;
        } else {
          snapCanvas.width = source.naturalWidth;
          snapCanvas.height = source.naturalHeight;
        }
        const snapCtx = snapCanvas.getContext("2d");
        snapCtx?.drawImage(source, 0, 0);
        const thumbnail = snapCanvas.toDataURL("image/jpeg", 0.7);
        
        performAIAnalysis(thumbnail);
      };

      interval = window.setInterval(trigger, config.intervalSeconds * 1000);
      // Run once immediately
      trigger();
    }
    return () => clearInterval(interval);
  }, [isMonitoring, config.intervalSeconds, config.source]);

  const performAIAnalysis = async (imageData: string) => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    addEvent("system", "Dispatching frame to local RPI5 LLM...");

    try {
      const base64 = imageData.split(",")[1];
      const response = await axios.post("/api/analyze-ollama", {
        model: config.ollamaModel,
        image: base64,
        prompt: config.aiPrompt,
        ollamaUrl: config.ollamaUrl
      });
      addEvent("ai_alert", `Local AI (${config.ollamaModel}): ` + (response.data.response || "No data"));
    } catch (err: any) {
      addEvent("system", "AI Analysis Error: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addEvent = async (type: DetectionEvent["type"], message: string) => {
    const newEvent: DetectionEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    
    setDetections(prev => [newEvent, ...prev].slice(0, 50));
    
    try {
      await axios.post("/api/log", {
        timestamp: new Date().toISOString(),
        event: type.toUpperCase(),
        details: message
      });
    } catch (e) {
      console.error("Failed to log to server", e);
    }
  };

  const downloadLog = () => {
    window.open("/api/download-log", "_blank");
  };

  return (
    <div className="flex flex-col h-screen w-full p-4 lg:p-6 gap-6 bg-slate-950 text-slate-100 font-sans overflow-hidden select-none">
      {/* Search patterns / Grid Background */}
      <div className="fixed inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:60px_60px]"></div>

      {/* Header */}
      <header className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center px-2 gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            <Camera className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight uppercase flex items-center gap-3">
              VIGILANT EYE <span className="text-slate-500 font-mono text-xs opacity-50">v1.2.0</span>
            </h1>
            <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400 tracking-wider">
              <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-slate-600'}`}></div>
              {isMonitoring ? `SYSTEM LIVE: ${config.source.toUpperCase()}` : 'SYSTEM STANDBY'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Active Model</div>
            <div className="text-xs font-mono text-slate-300">
               {config.aiProvider === 'gemini' ? 'Gemini 3 Flash' : 'Local Ollama'}
            </div>
          </div>
          <div className="h-10 w-px bg-slate-800 hidden sm:block"></div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-slate-600 transition-all text-slate-400 hover:text-white"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsMonitoring(!isMonitoring)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all
                ${isMonitoring 
                  ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white' 
                  : 'bg-emerald-600 border border-emerald-500 text-white hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]'}`}
            >
              {isMonitoring ? <><StopCircle className="w-4 h-4" /> Terminate</> : <><Play className="w-4 h-4" /> Engage System</>}
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="relative z-10 grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-4 lg:gap-6 flex-1 min-h-0">
        
        {/* Monitoring Card */}
        <div className="md:col-span-8 md:row-span-4 bento-card feed-container relative group overflow-hidden flex flex-col">
          <div className="absolute inset-0 scanline pointer-events-none opacity-50"></div>
          <div className="p-4 flex justify-between items-start z-10">
            <div className="flex gap-2">
              <span className="bg-black/80 backdrop-blur-md px-2.5 py-1 rounded text-[10px] font-mono border border-white/10 uppercase font-bold tracking-tight">
                {config.source === 'webcam' ? 'LCL-CAM-01' : 'NET-CAM-08'}
              </span>
              <span className="bg-black/80 backdrop-blur-md px-2.5 py-1 rounded text-[10px] font-mono border border-white/10 uppercase font-bold text-slate-400">
                1080P // 30FPS
              </span>
            </div>
            {isMonitoring && (
               <span className="bg-red-500/20 text-red-400 px-2.5 py-1 rounded text-[10px] font-bold border border-red-500/40 uppercase animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                REC // TIMED_TRIGGER
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center p-2 relative">
             {isMonitoring ? (
               <>
                 {config.source === "webcam" ? (
                   <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain rounded-lg" />
                 ) : rtspFrame ? (
                   <img ref={imgRef} src={rtspFrame} className="w-full h-full object-contain rounded-lg" alt="RTSP Stream" />
                 ) : (
                   <div className="flex flex-col items-center gap-4 opacity-40">
                     <RefreshCw className="w-12 h-12 animate-spin text-emerald-400" />
                     <p className="font-mono text-xs uppercase tracking-widest">Awaiting Frame...</p>
                   </div>
                 )}
               </>
             ) : (
               <div className="relative opacity-20 group-hover:opacity-30 transition-all">
                  <ShieldCheck className="w-48 h-48 text-slate-400" strokeWidth={1} />
               </div>
             )}
          </div>

          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md p-3 rounded-xl border border-white/5 z-10">
            <div className="text-[9px] text-slate-400 mb-0.5 font-bold uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3 h-3 text-emerald-500" /> SENSOR_INPUT
            </div>
            <div className="text-xs font-mono text-emerald-400">
               {isMonitoring ? `${new Date().toLocaleTimeString()} :: ACTIVE_CAPTURE` : '00:00:00 // DISCONNECTED'}
            </div>
          </div>
        </div>

        {/* Sidebar Log */}
        <div className="md:col-span-4 md:row-span-6 bento-card flex flex-col overflow-hidden">
          <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/30">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
              <List className="w-4 h-4 text-emerald-500" /> Intelligence Feed
            </h2>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
              {detections.length} Events
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-4">
            <AnimatePresence initial={false}>
              {detections.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-10 gap-4 mt-20">
                    <Layers className="w-16 h-16" strokeWidth={1} />
                    <p className="text-[10px] font-mono uppercase tracking-[0.3em]">Monitoring Idle</p>
                </div>
              ) : (
                detections.map((det) => (
                  <motion.div
                    key={det.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-xl border transition-all
                      ${det.type === 'motion' ? 'bg-amber-500/5 border-amber-500/20 border-l-4 border-l-amber-500' : 
                        det.type === 'ai_alert' ? 'bg-emerald-500/5 border-emerald-500/20 border-l-4 border-l-emerald-500' : 
                        'bg-slate-800/30 border-slate-700/50'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-[8px] font-mono font-bold uppercase tracking-widest
                         ${det.type === 'motion' ? 'text-amber-400' : 
                           det.type === 'ai_alert' ? 'text-emerald-400' : 
                           'text-slate-500'}`}>
                        {det.timestamp}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold
                         ${det.type === 'motion' ? 'bg-amber-500/20 text-amber-500' : 
                           det.type === 'ai_alert' ? 'bg-emerald-500/20 text-emerald-500' : 
                           'bg-slate-700 text-slate-400'}`}>
                        {det.type}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300 font-mono italic">
                       {det.message}
                    </p>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Controls Card */}
        <div className="md:col-span-4 md:row-span-2 bento-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Experiment Controls
            </h2>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Analysis Interval</span>
                  <span className="text-xs font-mono text-emerald-400">{config.intervalSeconds}s</span>
                </div>
                <div className="relative group">
                  <input 
                    type="range" 
                    min="1" 
                    max="60" 
                    value={config.intervalSeconds}
                    onChange={(e) => setConfig({...config, intervalSeconds: parseInt(e.target.value)})}
                    className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="absolute top-0 h-1.5 bg-emerald-500 rounded-full pointer-events-none transition-all" style={{ width: `${(config.intervalSeconds/60)*100}%` }}></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Inference Depth</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`w-3.5 h-3.5 rounded-sm transition-colors ${i <= 2 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-slate-800 border border-slate-700'}`}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Data Persistence Card */}
        <div className="md:col-span-4 md:row-span-2 bento-card p-6 flex flex-col justify-between group">
          <div className="flex justify-between items-start">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
               <FileText className="w-4 h-4" /> Data Persistence
            </h2>
            <div className="bg-emerald-500/10 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-all">
               <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <div className="text-2xl font-mono font-bold tracking-tighter text-white">
                {detections.length > 0 ? (detections.length * 0.1).toFixed(1) : '0.0'} <span className="text-xs text-slate-500">KB</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono tracking-tight uppercase">current_session_log.txt</div>
            </div>
            <button 
              onClick={downloadLog}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        </div>

      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 w-full max-w-md rounded-3xl border border-slate-800 overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)]"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <h2 className="text-xs font-bold uppercase tracking-[0.3em] font-mono text-slate-400">Tactical Config</h2>
                <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white transition-colors">
                   <RefreshCw className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest font-mono">Stream Vector</label>
                  <select 
                    value={config.source}
                    onChange={(e) => setConfig({...config, source: e.target.value as any})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-slate-300 font-mono"
                  >
                    <option value="webcam">LOCAL_SYSTEM_REF</option>
                    <option value="rtsp">REMOTE_RTSP_VECTOR</option>
                  </select>
                </div>

                {config.source === 'rtsp' && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest font-mono">Target Address</label>
                    <input 
                      type="text"
                      placeholder="rtsp://admin:pass@192.168.1.100:554/live"
                      value={config.url}
                      onChange={(e) => setConfig({...config, url: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-xs font-mono focus:outline-none focus:border-emerald-500 transition-colors text-emerald-400 placeholder:text-slate-800"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest font-mono">Analysis Instruction (Prompt)</label>
                  <textarea 
                    rows={3}
                    value={config.aiPrompt}
                    onChange={(e) => setConfig({...config, aiPrompt: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:border-emerald-500 transition-colors text-slate-300 resize-none"
                    placeholder="Describe exactly what the AI should look for..."
                  />
                </div>

                <div className="space-y-4 pt-2 border-t border-slate-800">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest font-mono">Local Model (Ollama)</label>
                    <input 
                      type="text"
                      value={config.ollamaModel}
                      onChange={(e) => setConfig({...config, ollamaModel: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-sm font-mono focus:outline-none focus:border-amber-500 transition-colors text-amber-500"
                      placeholder="e.g. granite4.1:3b"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest font-mono">Raspberry Pi Node URI</label>
                    <input 
                      type="text"
                      value={config.ollamaUrl}
                      onChange={(e) => setConfig({...config, ollamaUrl: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors text-slate-300"
                    />
                  </div>
                </div>
                
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold uppercase tracking-[0.4em] transform active:scale-95 transition-all text-[10px] shadow-[0_0_30px_rgba(16,185,129,0.1)]"
                >
                  Apply Protocols
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Canvas for Motion Logic */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}


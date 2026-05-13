import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import cors from "cors";

const LOG_FILE = path.join(process.cwd(), "detections.txt");

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Log a new event
  app.post("/api/log", (req, res) => {
    const { timestamp, event, details } = req.body;
    const logEntry = `[${timestamp}] ${event}: ${details}\n`;
    
    fs.appendFileSync(LOG_FILE, logEntry);
    res.json({ success: true });
  });

  // Get current log content
  app.get("/api/logs", (req, res) => {
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      res.send(content);
    } else {
      res.send("");
    }
  });

  // Download log file
  app.get("/api/download-log", (req, res) => {
    if (fs.existsSync(LOG_FILE)) {
      res.download(LOG_FILE, "camera_log.txt");
    } else {
      res.status(404).send("No log file found.");
    }
  });

  // Ollama Analysis Proxy
  app.post("/api/analyze-ollama", async (req, res) => {
    const { model, image, prompt, ollamaUrl } = req.body;
    try {
      const response = await axios.post(`${ollamaUrl}/api/generate`, {
        model: model,
        prompt: prompt,
        images: [image],
        stream: false
      }, { timeout: 30000 });
      
      res.json(response.data);
    } catch (error: any) {
      console.error("Ollama error:", error.message);
      res.status(500).json({ error: "Failed to connect to Ollama on RPI5. Ensure it is running and accessible." });
    }
  });

  // Snapshot from RTSP
  app.get("/api/snapshot", (req, res) => {
    const rtspUrl = req.query.url as string;
    if (!rtspUrl) {
      return res.status(400).json({ error: "Missing RTSP URL" });
    }

    const outputPath = path.join(process.cwd(), "snapshot.jpg");
    // Command to grab one frame from RTSP
    const command = `ffmpeg -y -i "${rtspUrl}" -frames:v 1 -q:v 2 "${outputPath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`ffmpeg error: ${error.message}`);
        return res.status(500).json({ error: "Failed to capture snapshot from RTSP" });
      }
      
      if (fs.existsSync(outputPath)) {
        const image = fs.readFileSync(outputPath);
        res.contentType('image/jpeg');
        res.send(image);
      } else {
        res.status(500).json({ error: "Snapshot file not created" });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Clear log on start if desired? No, let's keep it for the session.
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, "--- Vigilant Eye Log Started ---\n");
    }
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});

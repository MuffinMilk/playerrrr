import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API proxy for JioSaavn
  app.get("/api/search", async (req, res) => {
    try {
      const { query } = req.query;
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const response = await axios.get(`https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodeURIComponent(query as string)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://www.jiosaavn.com/'
        }
      });
      res.json(response.data);
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).json({ error: "Failed to fetch from JioSaavn" });
    }
  });

  // Proxy for audio streams
  app.get("/api/proxy-audio", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }
      
      const response = await axios({
        method: 'get',
        url: url as string,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://www.jiosaavn.com/'
        }
      });

      res.setHeader('Content-Type', response.headers['content-type']);
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      res.setHeader('Accept-Ranges', 'bytes');

      response.data.pipe(res);
    } catch (error) {
      console.error("Audio proxy error:", error);
      res.status(500).json({ error: "Failed to proxy audio" });
    }
  });

  // Proxy for images
  app.get("/api/proxy-image", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }
      
      const response = await axios({
        method: 'get',
        url: url as string,
        responseType: 'stream'
      });

      res.setHeader('Content-Type', response.headers['content-type']);
      response.data.pipe(res);
    } catch (error) {
      console.error("Image proxy error:", error);
      res.status(500).json({ error: "Failed to proxy image" });
    }
  });

  // Proxy for lyrics (LRCLIB)
  app.get("/api/lyrics", async (req, res) => {
    try {
      const { artist, title } = req.query;
      if (!artist || !title) {
        return res.status(400).json({ error: "Artist and title are required" });
      }
      
      const response = await axios.get(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist as string)}&track_name=${encodeURIComponent(title as string)}`);
      res.json(response.data);
    } catch (error) {
      console.error("Lyrics proxy error:", error);
      res.status(500).json({ error: "Failed to fetch lyrics" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

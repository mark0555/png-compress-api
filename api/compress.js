// api/compress.js
import formidable from "formidable";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import sharp from "sharp";

export const config = { api: { bodyParser: false } };

// CORS（必要なければ削除OK）
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const form = new formidable.IncomingForm({
    multiples: true,
    keepExtensions: true,
    uploadDir: os.tmpdir(),        // Vercelの一時領域
    maxFileSize: 25 * 1024 * 1024  // 25MB/枚（必要なら調整）
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error", detail: String(err) });

    try {
      const uploaded = Array.isArray(files.files) ? files.files : [files.files];

      // 無料枠対策：3枚ずつ並列
      const batchSize = 3;
      const groups = [];
      for (let i = 0; i < uploaded.length; i += batchSize) groups.push(uploaded.slice(i, i + batchSize));

      const outPaths = [];
      for (const group of groups) {
        const results = await Promise.all(
          group.map(async (file) => {
            const outPath = file.filepath + "-min.png";
            await sharp(file.filepath)
              .png({ quality: 80, compressionLevel: 9 }) // 好みで調整可
              .toFile(outPath);
            return outPath;
          })
        );
        outPaths.push(...results);
      }

      if (!outPaths.length) return res.status(500).json({ error: "No files processed" });

      // メモリでZIP作成→返却
      const zip = new AdmZip();
      outPaths.forEach((p) => zip.addLocalFile(p));
      const zipBuf = zip.toBuffer();

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=compressed.zip");
      res.end(zipBuf);

      // 後片付け
      [...uploaded.map(f => f.filepath), ...outPaths].forEach(p => { try { fs.unlinkSync(p); } catch {} });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Internal error", detail: String(e) });
    }
  });
}

// api/compress.js
import formidable from "formidable";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import util from "util";
import AdmZip from "adm-zip";
import pngquant from "pngquant-bin";

export const config = { api: { bodyParser: false } };
const execFileAsync = util.promisify(execFile);

// CORS（WPからの呼び出しを許可）
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const form = formidable({
    multiples: true,
    keepExtensions: true,
    uploadDir: os.tmpdir(),        // Vercelの一時領域
    maxFileSize: 50 * 1024 * 1024, // 50MB/枚（必要に応じて調整）
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error" });

    try {
      const uploaded = Array.isArray(files.files) ? files.files : [files.files];

      // 無料枠のタイムアウト対策：3枚ずつ並列処理（必要なら 2〜3 に調整）
      const groupSize = 3;
      const groups = [];
      for (let i = 0; i < uploaded.length; i += groupSize) {
        groups.push(uploaded.slice(i, i + groupSize));
      }

      const outPaths = [];
      for (const group of groups) {
        const results = await Promise.all(
          group.map(async (file) => {
            const outPath = file.filepath + "-min.png";
            await execFileAsync(pngquant, [
              "--quality=60-90",
              "--speed=2",
              "--output", outPath,
              file.filepath,
            ]);
            return outPath;
          })
        );
        outPaths.push(...results);
      }

      // ディスクに書かず、メモリでZIP化して返す
      const zip = new AdmZip();
      outPaths.forEach((p) => zip.addLocalFile(p));
      const zipBuf = zip.toBuffer();

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=compressed.zip");
      res.end(zipBuf);

      // 後片付け（tryで握りつぶし）
      [...uploaded.map(f => f.filepath), ...outPaths].forEach(p => { try { fs.unlinkSync(p); } catch {} });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || "Internal error" });
    }
  });
}

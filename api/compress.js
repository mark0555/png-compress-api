import formidable from "formidable";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import util from "util";
import AdmZip from "adm-zip";
import pngquant from "pngquant-bin";

export const config = { api: { bodyParser: false } };
const execFileAsync = util.promisify(execFile);

// CORS（WPから直叩き可）
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
    uploadDir: os.tmpdir(),
    maxFileSize: 25 * 1024 * 1024 // 25MB/枚（必要に応じて上げる）
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error", detail: String(err) });

    try {
      const uploaded = Array.isArray(files.files) ? files.files : [files.files];

      // Hobbyの10秒タイムアウト対策：2枚ずつ並列
      const batchSize = 2;
      const groups = [];
      for (let i = 0; i < uploaded.length; i += batchSize) {
        groups.push(uploaded.slice(i, i + batchSize));
      }

      const outPaths = [];
      for (const group of groups) {
        const results = await Promise.allSettled(
          group.map(async (file) => {
            const outPath = file.filepath + "-min.png";
            // 失敗しにくい設定（速め）
            const args = ["--quality=65-85", "--speed=3", "--output", outPath, file.filepath];
            await execFileAsync(pngquant, args, { timeout: 9000 }); // 9秒で打ち切り
            return outPath;
          })
        );
        for (const r of results) if (r.status === "fulfilled") outPaths.push(r.value);
      }

      if (!outPaths.length) {
        return res.status(500).json({ error: "Compression failed for all files" });
      }

      // メモリでZIP化して返す（ディスクに書かない）
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
      return res.status(500).json({ error: "Internal error", detail: String(e) });
    }
  });
}

// api/compress.js
import formidable from "formidable";
import fs from "fs";
import os from "os";
import AdmZip from "adm-zip";
import sharp from "sharp";

export const config = { api: { bodyParser: false } };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // 必要なら: res.setHeader("Access-Control-Expose-Headers", "Content-Type, Content-Disposition");
}

export default async function handler(req, res) {
  // どの経路でも最初に必ずCORSを付与
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const form = new formidable.IncomingForm({
      multiples: true,
      keepExtensions: true,
      uploadDir: os.tmpdir(),
      maxFileSize: 25 * 1024 * 1024,
    });

    // formidableのエラー応答にもCORSが乗るよう、このスコープでもtry/catch
    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          setCors(res);
          return res.status(500).json({ error: "Upload error", detail: String(err) });
        }

        const uploaded = Array.isArray(files.files) ? files.files : [files.files];
        if (!uploaded?.[0]) {
          setCors(res);
          return res.status(400).json({ error: "No files" });
        }

        // 3枚ずつ並列（Hobby対策）
        const batchSize = 3;
        const outPaths = [];
        for (let i = 0; i < uploaded.length; i += batchSize) {
          const group = uploaded.slice(i, i + batchSize);
          const results = await Promise.all(
            group.map(async (file) => {
              const outPath = file.filepath + "-min.png";
              await sharp(file.filepath).png({ quality: 80, compressionLevel: 9 }).toFile(outPath);
              return outPath;
            })
          );
          outPaths.push(...results);
        }

        if (!outPaths.length) {
          setCors(res);
          return res.status(500).json({ error: "Processing failed" });
        }

        const zip = new AdmZip();
        outPaths.forEach((p) => zip.addLocalFile(p));
        const zipBuf = zip.toBuffer();

        setCors(res);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=compressed.zip");
        res.end(zipBuf);

        // 後片付け
        [...uploaded.map(f => f.filepath), ...outPaths].forEach(p => { try { fs.unlinkSync(p); } catch {} });
      } catch (e) {
        // parse コールバック内での例外でもCORSを付けて返す
        setCors(res);
        console.error(e);
        return res.status(500).json({ error: "Internal error", detail: String(e) });
      }
    });
  } catch (e) {
    // 予期せぬトップレベル例外でもCORSを付けて返す
    setCors(res);
    console.error(e);
    return res.status(500).json({ error: "Fatal error", detail: String(e) });
  }
}

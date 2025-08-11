// api/compress.js — Colors & Dither 対応（CORS強化・Sharp量子化）
import { formidable } from "formidable";
import fs from "fs";
import os from "os";
import AdmZip from "adm-zip";
import sharp from "sharp";

export const config = { api: { bodyParser: false } };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // res.setHeader("Access-Control-Expose-Headers", "Content-Type, Content-Disposition");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      uploadDir: os.tmpdir(),
      maxFileSize: 25 * 1024 * 1024,
    });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) { setCors(res); return res.status(500).json({ error: "Upload error", detail: String(err) }); }

        // 受け取り & バリデーション
        const colorsIn = parseInt(fields?.colors?.toString?.() ?? "32", 10);
        const colors = Number.isFinite(colorsIn) ? Math.max(2, Math.min(256, colorsIn)) : 32;
        const dither = (fields?.dither?.toString?.() ?? "1") === "1"; // true/false

        const list = files?.files;
        const uploaded = Array.isArray(list) ? list : (list ? [list] : []);
        if (!uploaded.length) { setCors(res); return res.status(400).json({ error: "No files" }); }

        const batchSize = 3;
        const outPaths = [];

        for (let i = 0; i < uploaded.length; i += batchSize) {
          const group = uploaded.slice(i, i + batchSize);
          const results = await Promise.all(
            group.map(async (file) => {
              const outPath = file.filepath + "-min.png";

              // PNG8（パレット）＋色数＆ディザ
              await sharp(file.filepath)
                .png({
                  palette: true,         // パレットPNG（PNG8）
                  colors,                // 色数（2〜256）
                  dither: dither ? 1.0 : 0.0, // ディザ強度（0〜1）
                  compressionLevel: 9,   // Deflate圧縮
                  effort: 7              // 追加最適化の努力値
                })
                .toFile(outPath);

              return outPath;
            })
          );
          outPaths.push(...results);
        }

        if (!outPaths.length) { setCors(res); return res.status(500).json({ error: "Processing failed" }); }

        const zip = new AdmZip();
        outPaths.forEach((p) => zip.addLocalFile(p));
        const zipBuf = zip.toBuffer();

        setCors(res);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=compressed.zip");
        res.end(zipBuf);

        // 後片付け
        [...uploaded.map((f) => f.filepath), ...outPaths].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
      } catch (e) {
        setCors(res);
        console.error(e);
        return res.status(500).json({ error: "Internal error", detail: String(e) });
      }
    });
  } catch (e) {
    setCors(res);
    console.error(e);
    return res.status(500).json({ error: "Fatal error", detail: String(e) });
  }
}

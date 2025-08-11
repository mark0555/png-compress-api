// api/compress.js — 元ファイル名を維持してZIPに格納（Colors/Dither対応 & CORS強化）
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
      maxFileSize: 25 * 1024 * 1024, // 25MB/枚
    });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          setCors(res);
          return res.status(500).json({ error: "Upload error", detail: String(err) });
        }

        // パラメータ（色数/ディザ）
        const colorsIn = parseInt(fields?.colors?.toString?.() ?? "32", 10);
        const colors = Number.isFinite(colorsIn) ? Math.max(2, Math.min(256, colorsIn)) : 32;
        const dither = (fields?.dither?.toString?.() ?? "1") === "1";

        // 受け取ったファイル配列を正規化
        const list = files?.files;
        const uploaded = Array.isArray(list) ? list : (list ? [list] : []);
        if (!uploaded.length) {
          setCors(res);
          return res.status(400).json({ error: "No files" });
        }

        // ZIPを作成（バッファで直接追加 → ファイル名を保持）
        const zip = new AdmZip();

        // Hobby帯向け：3枚ずつ並列
        const batchSize = 3;
        for (let i = 0; i < uploaded.length; i += batchSize) {
          const group = uploaded.slice(i, i + batchSize);
          const results = await Promise.all(
            group.map(async (file) => {
              const origName = file.originalFilename || "image.png";
              const lower = origName.toLowerCase();
              // JPEGはPNGに変換するので拡張子だけ置換、PNGはそのまま
              const base = origName.replace(/\.[^/.]+$/, "");
              const outName = lower.endsWith(".png") ? origName : `${base}.png`;

              // PNG8（パレット）＋色数＆ディザ → バッファで取得
              const buf = await sharp(file.filepath)
                .png({
                  palette: true,
                  colors,
                  dither: dither ? 1.0 : 0.0,
                  compressionLevel: 9,
                  effort: 7,
                })
                .toBuffer();

              // ZIP内の「ファイル名」に outName を使用（＝元名を維持）
              zip.addFile(outName, buf);
            })
          );
          void results;
        }

        const zipBuf = zip.toBuffer();

        setCors(res);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", 'attachment; filename="compressed.zip"');
        res.end(zipBuf);

        // 一時ファイル片付け
        uploaded.forEach((f) => {
          try { fs.unlinkSync(f.filepath); } catch {}
        });
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

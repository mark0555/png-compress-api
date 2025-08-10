import formidable from "formidable";
import fs from "fs";
import { execFile } from "child_process";
import path from "path";
import util from "util";
import AdmZip from "adm-zip";

export const config = {
  api: {
    bodyParser: false,
  },
};

const execFileAsync = util.promisify(execFile);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const form = formidable({ multiples: true });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error" });

    try {
      const uploaded = Array.isArray(files.files) ? files.files : [files.files];
      const outPaths = [];

      for (const file of uploaded) {
        const outPath = file.filepath + "-min.png";
        await execFileAsync("pngquant", [
          "--quality=60-90",
          "--speed=2",
          "--output",
          outPath,
          file.filepath,
        ]);
        outPaths.push(outPath);
      }

      const zip = new AdmZip();
      outPaths.forEach((p) => {
        zip.addLocalFile(p);
      });

      const zipPath = path.join(process.cwd(), "out.zip");
      zip.writeZip(zipPath);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=compressed.zip");
      res.send(fs.readFileSync(zipPath));

      [...uploaded.map(f => f.filepath), ...outPaths, zipPath].forEach((p) => {
        fs.unlinkSync(p);
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
}

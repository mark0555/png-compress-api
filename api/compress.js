import sharp from "sharp";

await sharp(file.filepath)
  .png({ quality: 80, compressionLevel: 9 })
  .toFile(outPath);

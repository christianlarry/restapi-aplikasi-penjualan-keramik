import fs from "fs"

export const deleteFile = (filePath: string) => {
  const fileExists = fs.existsSync(filePath);
  if (!fileExists) return;

  fs.unlink(filePath, (err) => {
    if (err) throw err
  })
}

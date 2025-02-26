const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Full base directory for Windows paths
const baseDir = "C:/Users/Ricardo/Dropbox/!_Programs/cygwin64/home/Ricardo/";
const mainDirectory = path.join(baseDir, "music/_DUPEFIND/1.Main/");
const artistDirectory = path.join(baseDir, "music/Artists/");

const kReadSize = 1024 * 8;
const SIZE_TOLERANCE = 0.9; // smaller file must be at least 90% the size of the larger one
const CONTENT_SIMILARITY_THRESHOLD = 0.95; // at least 95% byte match overall

/**
 * Compares two files by checking for similar size and content similarity.
 * It first checks that the file sizes are within an acceptable range,
 * then reads the overlapping portion and computes a similarity ratio.
 * Extra bytes in the larger file count as mismatches.
 *
 * @param {string} fname1 - Path to the first file.
 * @param {string} fname2 - Path to the second file.
 * @returns {Promise<boolean>} - Resolves to true if files are similar, false otherwise.
 */
async function compareFilesSimilar(fname1, fname2) {
  let h1, h2;
  try {
    h1 = await fsp.open(fname1);
    h2 = await fsp.open(fname2);
    const [stat1, stat2] = await Promise.all([h1.stat(), h2.stat()]);
    
    // Check size similarity
    const maxSize = Math.max(stat1.size, stat2.size);
    const minSize = Math.min(stat1.size, stat2.size);
    if (minSize / maxSize < SIZE_TOLERANCE) {
      return false;
    }
    
    // Compare content for the overlapping region (minSize bytes)
    const buf1 = Buffer.alloc(kReadSize);
    const buf2 = Buffer.alloc(kReadSize);
    let pos = 0;
    let matchingBytes = 0;
    
    while (pos < minSize) {
      const readSize = Math.min(kReadSize, minSize - pos);
      const [r1, r2] = await Promise.all([
        h1.read(buf1, 0, readSize, pos),
        h2.read(buf2, 0, readSize, pos)
      ]);
      
      if (r1.bytesRead !== readSize || r2.bytesRead !== readSize) {
        throw new Error("Failed to read desired number of bytes");
      }
      
      // Count matching bytes in this chunk.
      for (let i = 0; i < readSize; i++) {
        if (buf1[i] === buf2[i]) {
          matchingBytes++;
        }
      }
      pos += readSize;
    }
    
    // Treat the extra bytes in the larger file as mismatches.
    // Total bytes considered equals the larger file's size.
    const similarityRatio = matchingBytes / maxSize;
    return similarityRatio >= CONTENT_SIMILARITY_THRESHOLD;
    
  } finally {
    if (h1) await h1.close();
    if (h2) await h2.close();
  }
}

/**
 * Recursively retrieves all files from a given directory.
 * @param {string} dir - The directory to search.
 * @returns {Promise<string[]>} - List of file paths.
 */
async function getAllFiles(dir) {
  let files = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(await getAllFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Converts a Windows-style file path to a Unix-style path by removing
 * the prefix "C:/Users/Ricardo/Dropbox/!_Programs/cygwin64" and ensuring
 * forward slashes are used.
 *
 * @param {string} filePath - The original file path.
 * @returns {string} - The Unix-style file path.
 */
function toUnixPath(filePath) {
  // Replace backslashes with forward slashes.
  let unixPath = filePath.replace(/\\/g, '/');
  // Remove the specific prefix.
  unixPath = unixPath.replace(/^C:\/Users\/Ricardo\/Dropbox\/!_Programs\/cygwin64/, '');
  // Ensure it starts with a slash.
  if (!unixPath.startsWith('/')) {
    unixPath = '/' + unixPath;
  }
  return unixPath;
}

/**
 * Processes each file in the main folder sequentially.
 * For each main file, it checks every file in the artist directory
 * to see if it is similar based on the criteria.
 * If a similar candidate is found, its Unix-style path is added;
 * if not, the main file's Unix-style path is added prefixed with "notfound:".
 * The resulting ordered list is written to "playlist.txt".
 */
async function processFiles() {
  try {
    // Retrieve all candidate files from the artist directory (including subfolders)
    const candidateFiles = await getAllFiles(artistDirectory);
    
    // Retrieve and filter for files in the main directory, then sort them numerically
    const mainDirEntries = await fsp.readdir(mainDirectory, { withFileTypes: true });
    const sortedMainFiles = mainDirEntries
      .filter(entry => entry.isFile())
      .sort((a, b) => {
        const aBase = path.basename(a.name, path.extname(a.name));
        const bBase = path.basename(b.name, path.extname(b.name));
        const aNum = parseInt(aBase, 10);
        const bNum = parseInt(bBase, 10);
        // If both names are valid numbers, compare numerically.
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        // Otherwise, fall back to locale string comparison.
        return aBase.localeCompare(bBase);
      });
    
    // Array to hold playlist entries.
    let playlistEntries = [];

    // Process each main file sequentially in sorted order.
    for (const entry of sortedMainFiles) {
      const mainFilePath = path.join(mainDirectory, entry.name);
      const baseName = path.basename(entry.name, path.extname(entry.name));
      console.log(`Processing main file: ${baseName}`);
      
      let found = false;
      // Iterate over every candidate file in the artist directory
      for (const candidateFile of candidateFiles) {
        const isSimilar = await compareFilesSimilar(mainFilePath, candidateFile);
        if (isSimilar) {
          console.log(`found: ${baseName} is similar to ${candidateFile}`);
          // Convert candidate file path to Unix style and add to playlist.
          playlistEntries.push(toUnixPath(candidateFile));
          found = true;
          break; // Stop checking further candidates for this main file
        }
      }
      
      if (!found) {
        console.log(`notfound: ${baseName}`);
        // Include the main file's Unix-style path with a "notfound:" prefix.
        playlistEntries.push("notfound:" + toUnixPath(mainFilePath));
      }
    }
    // Write the playlist entries to a text file (one entry per line)
    await fsp.writeFile("playlist.txt", playlistEntries.join("\n"));
    console.log("Playlist file created: playlist.txt");
  } catch (error) {
    console.error("Error processing files:", error);
  }
}

// Execute the sequential file processing.
processFiles();
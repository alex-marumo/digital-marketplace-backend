const fs = require('fs').promises;
const path = require('path');
const { pool } = require('./db'); // Adjust to your DB setup

async function cleanupOrphanedImages() {
  try {
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const files = await fs.readdir(uploadsDir);
    const { rows } = await pool.query('SELECT image_url FROM artworks');
    const validFiles = rows.map(row => path.basename(row.image_url));

    for (const file of files) {
      if (!validFiles.includes(file)) {
        const filePath = path.join(uploadsDir, file);
        await fsPromises.unlink(filePath);
        console.log(`🗑️ Deleted orphaned file: ${filePath}`);
      }
    }
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
  }
}

cleanupOrphanedImages();
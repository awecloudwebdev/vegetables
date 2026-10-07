/**
 * server.js - Express server for the "Six Vegetables" PWA.
 *
 * Responsibilities:
 *   1. Serve the front-end files in /public (HTML, CSS, JS, manifest, service worker).
 *   2. Provide a small JSON API:
 *        GET  /api/comments?page=carrot   -> list comments for one vegetable page
 *        POST /api/comments               -> add a comment (saved to comments.json)
 */

const express = require('express');   // the web framework
const fs = require('fs/promises');    // promise-based file system functions
const path = require('path');         // safe path building across operating systems

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuration ----------------------------------------------------------

// Where comments are stored. __dirname = the folder this file lives in.
const DB_FILE = path.join(__dirname, 'comments.json');

// The only page ids the API will accept. Anything else is rejected.
const VALID_PAGES = ['carrot', 'broccoli', 'beetroot', 'eggplant', 'spinach', 'pumpkin'];

// Maximum lengths so nobody can fill your disk with a giant comment.
const MAX_NAME = 60;
const MAX_COMMENT = 1000;

// --- Tiny JSON "database" ---------------------------------------------------

/** Read every comment from comments.json. Returns [] if the file is missing or broken. */
async function readAll() {
  try {
    const text = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/**
 * Several people can post at the same moment. If two requests each read the file,
 * add a comment, and write it back, one comment would be lost. So we chain every
 * write onto a "queue" (a promise) to make sure they run one at a time.
 */
let writeQueue = Promise.resolve();

function addComment(entry) {
  const job = writeQueue.then(async () => {
    const all = await readAll();
    all.push(entry);
    // Write to a temp file first, then rename. Rename is atomic, so a crash
    // mid-write can never leave a half-written comments.json behind.
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(all, null, 2));
    await fs.rename(tmp, DB_FILE);
  });
  // Keep the queue alive even if this job fails, so later posts still work.
  writeQueue = job.catch(() => {});
  return job; // the route handler awaits this to know when saving finished
}

// --- Middleware (runs on every request, in order) ---------------------------

// Parse JSON request bodies into req.body. The limit rejects oversized bodies.
app.use(express.json({ limit: '10kb' }));

// --- API routes -------------------------------------------------------------

// GET /api/comments?page=carrot
app.get('/api/comments', async (req, res, next) => {
  try {
    const page = req.query.page;
    const all = await readAll();
    res.json(all.filter(c => c.page === page)); // only this vegetable's comments
  } catch (err) {
    next(err); // hand unexpected errors to the error handler at the bottom
  }
});

// POST /api/comments   body: { "page": "carrot", "name": "Sam", "comment": "Tasty!" }
app.post('/api/comments', async (req, res, next) => {
  try {
    // Never trust client input: convert to strings, trim spaces, enforce length.
    const page = String(req.body.page || '');
    const name = String(req.body.name || '').trim().slice(0, MAX_NAME);
    const comment = String(req.body.comment || '').trim().slice(0, MAX_COMMENT);

    if (!VALID_PAGES.includes(page)) {
      return res.status(400).json({ error: 'Unknown page.' });
    }
    if (!name || !comment) {
      return res.status(400).json({ error: 'Name and comment are required.' });
    }

    // Build the record that gets stored in comments.json.
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // unique-enough id
      page,
      name,
      comment,
      date: new Date().toISOString()
    };

    await addComment(entry);                 // wait until it is safely on disk
    console.log(`[comment] ${page} by ${name}`);
    res.status(201).json(entry);             // 201 = "Created"
  } catch (err) {
    next(err);
  }
});

// --- Static files -----------------------------------------------------------

// Serve everything in /public. "/" automatically returns public/index.html.
app.use(express.static(path.join(__dirname, 'public')));

// The service worker must never be cached by the browser, or updates won't arrive.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// --- Fallbacks --------------------------------------------------------------

// Nothing above matched: unknown API paths get JSON, everything else a plain 404.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found');
});

// Error handler (four arguments tells Express this is the error handler).
// Catches bad JSON from express.json() and anything passed to next(err).
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

// --- Start ------------------------------------------------------------------

app.listen(PORT, () => console.log(`Six Vegetables running at http://localhost:${PORT}`));

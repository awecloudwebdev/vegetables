/**
 * server.js - Express server for the "Six Vegetables" PWA.
 *
 * Responsibilities:
 *   1. Serve the front-end files in /public (HTML, CSS, JS, manifest, service worker).
 *   2. Provide a small JSON API:
 *        GET  /api/comments?page=carrot   -> list comments for one vegetable page
 *        POST /api/comments               -> add a comment (saved to comments.json)
 *   3. LIVE UPDATES: when anyone posts a comment, every open page is told about it,
 *      shows a notification, and refreshes its comment list. This is all done from
 *      this file: the server injects a small script (/live.js) into index.html.
 *        POST /api/poll                   -> long-poll: waits until a new comment arrives
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

// How long (ms) the server holds a live-update request open before saying "nothing new".
const POLL_TIMEOUT = 25000;

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

// --- Live updates (long-polling) --------------------------------------------
//
// How it works:
//   * Every new comment becomes an "event" with a rising number (seq).
//   * Each open browser tab keeps ONE request open to POST /api/poll, saying
//     "the last event I saw was number N". The server holds that request open.
//   * When a comment is posted, the server answers every waiting request at once.
//     The browser shows a notification, refreshes the list, and asks again.
//   * If a tab was briefly offline, it asks "since N" and gets anything it missed
//     from the list of recent events.
//
// Why POST and not the more common GET/EventSource? The service worker caches GET
// requests, which would try to store a never-ending stream. It ignores POST requests,
// so POST keeps live updates working without touching sw.js.

let seq = 0;            // number of the newest event
const recent = [];      // the last 50 events, kept in memory
const waiting = new Set(); // requests currently being held open

/** Record a new-comment event and answer everyone who is waiting. */
function publish(entry, clientId) {
  const event = {
    seq: ++seq,
    page: entry.page,
    name: entry.name,
    date: entry.date,
    clientId // lets the poster's own tab skip the "someone commented" notice
  };
  recent.push(event);
  if (recent.length > 50) recent.shift(); // keep memory use small

  for (const w of waiting) {
    clearTimeout(w.timer);
    w.res.json({ seq, events: recent.filter(e => e.seq > w.since) });
  }
  waiting.clear();
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

    // NOTIFY: log it in the terminal and tell every open browser tab.
    console.log(`[comment] New comment on "${page}" by ${name}`);
    const clientId = String(req.get('X-Client-Id') || '').slice(0, 40); // which tab posted it
    publish(entry, clientId);

    res.status(201).json(entry);             // 201 = "Created"
  } catch (err) {
    next(err);
  }
});

// POST /api/poll   body: { "since": 12 }  (or null the first time)
// Replies with { seq, events: [...] } as soon as there is something new.
app.post('/api/poll', (req, res) => {
  const since = req.body && Number.isInteger(req.body.since) ? req.body.since : null;

  // First call (null), or the server restarted and numbers started again:
  // just tell the browser the current number so it can start listening from here.
  if (since === null || since > seq) return res.json({ seq, events: [] });

  // The browser missed something (for example it was offline): send it right away.
  const missed = recent.filter(e => e.seq > since);
  if (missed.length) return res.json({ seq, events: missed });

  // Nothing new yet: hold the request open. publish() will answer it, or the timer
  // below will, so the browser's request never hangs forever.
  const waiter = { res, since };
  waiter.timer = setTimeout(() => {
    waiting.delete(waiter);
    res.json({ seq, events: [] });
  }, POLL_TIMEOUT);
  waiting.add(waiter);

  // If the browser goes away (tab closed, navigation), stop tracking it.
  res.on('close', () => {
    clearTimeout(waiter.timer);
    waiting.delete(waiter);
  });
});

// --- Live-update script for the browser -------------------------------------

/**
 * This function is NOT run by the server. Its source code is sent to the browser
 * at /live.js (see below), so it must not use anything defined in this file.
 * It relies on two things already in public/app.js: the menu links and the
 * loadComments() function.
 */
function liveClient() {
  const CLIENT_ID = Math.random().toString(36).slice(2); // identifies this browser tab
  const nativeFetch = window.fetch.bind(window);

  // Add an X-Client-Id header to our own comment posts, so the server can tell the
  // poster's tab apart from everyone else's.
  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const isCommentPost = init.method === 'POST' && new URL(url, location.href).pathname === '/api/comments';
    if (isCommentPost) {
      init = Object.assign({}, init, { headers: Object.assign({}, init.headers, { 'X-Client-Id': CLIENT_ID }) });
    }
    return nativeFetch(input, init);
  };

  // --- The notification box (a small "toast" at the bottom of the screen) ---
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');       // screen readers announce it
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    position: 'fixed', left: '50%', bottom: '1.2rem', transform: 'translateX(-50%)',
    maxWidth: '90vw', padding: '.7rem 1.1rem', background: '#17261b', color: '#fff',
    borderLeft: '6px solid #ffd23f', borderRadius: '8px', zIndex: '20', display: 'none',
    font: '600 .95rem "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,.3)'
  });
  document.body.appendChild(toast);

  let hideTimer;
  function showToast(event) {
    const link = document.querySelector('.menu a[data-id="' + event.page + '"]');
    const veggie = link ? link.textContent : event.page;
    toast.textContent = event.name + ' commented on ' + veggie + '. '; // textContent = safe for user input

    // If they are on a different page, offer a button to jump there.
    if (event.page !== currentPage()) {
      const go = document.createElement('button');
      go.textContent = 'View';
      Object.assign(go.style, { font: 'inherit', cursor: 'pointer', borderRadius: '6px', border: 0, padding: '.2rem .7rem' });
      go.onclick = () => { location.hash = event.page; toast.style.display = 'none'; };
      toast.appendChild(go);
    }

    toast.style.display = 'block';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { toast.style.display = 'none'; }, 6000);
  }

  // The page being viewed = the highlighted menu link.
  function currentPage() {
    const a = document.querySelector('.menu a[aria-current="page"]');
    return a ? a.dataset.id : null;
  }

  // --- Handle one batch of events from the server ---
  function handle(events) {
    // Ignore comments this tab posted itself (app.js already refreshes for those).
    const others = events.filter(e => e.clientId !== CLIENT_ID);
    if (others.length) showToast(others[others.length - 1]); // show the newest one

    // If any new comment belongs to the page on screen, reload its comment list.
    const now = currentPage();
    const list = document.getElementById('list');
    if (list && events.some(e => e.page === now && e.clientId !== CLIENT_ID)) {
      loadComments(now, list); // defined in app.js
    }
  }

  // --- The loop: ask the server "anything new since N?", wait, repeat ---
  let since = null;
  async function poll() {
    try {
      const res = await nativeFetch('/api/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since })
      });
      if (!res.ok) throw new Error('poll failed');
      const data = await res.json();
      since = data.seq;
      if (data.events.length) handle(data.events);
      poll(); // ask again straight away
    } catch {
      setTimeout(poll, 5000); // offline or server down: try again in 5 seconds
    }
  }
  poll();
}

// Serve the function above as a script file.
app.get('/live.js', (req, res) => {
  res.type('text/javascript').set('Cache-Control', 'no-cache');
  res.send('(' + liveClient.toString() + ')();');
});

// --- Static files -----------------------------------------------------------

// Serve index.html with one extra line added: the <script> tag that loads /live.js.
// This route comes BEFORE express.static so it wins for "/" and "/index.html".
app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    const html = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
    res.type('html').send(html.replace('</body>', '  <script src="/live.js"></script>\n</body>'));
  } catch (err) {
    next(err);
  }
});

// Serve everything else in /public (CSS, app.js, manifest, icon...).
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
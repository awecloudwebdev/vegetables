/**
 * app.js - front-end logic. One HTML page, six "pages" chosen by the URL hash
 * (#carrot, #broccoli ...). Changing the hash redraws the content, no reload.
 */

// ---- 1. Content: one object per vegetable (the six pages) ----
// id = used in the URL hash and saved with each comment; color = that page's accent.
const VEGGIES = [
  { id: 'carrot', name: 'Carrot', color: '#e8742a', tag: 'Sweet, crunchy, and secretly a root.',
    text: ['Carrots are taproots: the orange part is the plant storing sugar underground for its second year of growth. Gardeners and cooks interrupt that plan, usually to everyone\'s benefit.',
      'Early cultivated carrots were purple and yellow. Orange varieties became common in Europe in the 1600s. Today you can still find purple, white, red, and yellow carrots at markets.',
      'Cooking makes carrots sweeter and helps your body use the beta-carotene they contain, which it converts to vitamin A. A little oil in the pan helps even more.'],
    facts: 'Best raw, roasted, or grated into cakes. Keep them in the fridge, tops removed.' },
  { id: 'broccoli', name: 'Broccoli', color: '#2f7d3a', tag: 'A tree-shaped flower bud you eat before it blooms.',
    text: ['The green heads of broccoli are clusters of flower buds. Leave one in the garden too long and it opens into tiny yellow flowers.',
      'Broccoli was developed from wild cabbage by farmers in Italy over many centuries. The name comes from the Italian word for "flowering crest."',
      'It is a good source of vitamin C and vitamin K, and the stalk is edible too. Peel the tough skin, slice it thin, and it cooks as tender as the florets.'],
    facts: 'Steam for 4 to 5 minutes to keep a bright color and a firm bite.' },
  { id: 'beetroot', name: 'Beetroot', color: '#a3204f', tag: 'Earthy, sweet, and impossible to wash off your hands.',
    text: ['Beetroot gets its deep red-purple color from pigments called betalains. They stain cutting boards, fingers, and, in some people, the next bathroom visit. It is harmless.',
      'Roasting whole in foil concentrates the sugar and makes the skins slip off easily. Raw, grated beets add color and crunch to salads.',
      'The leaves are edible, too. Cook them like chard or spinach rather than throwing them away.'],
    facts: 'Wear gloves when peeling. A splash of lemon or vinegar balances the earthy flavor.' },
  { id: 'eggplant', name: 'Eggplant', color: '#5b3a8c', tag: 'Glossy, spongy, and happiest in a hot pan.',
    text: ['Botanically, eggplant is a berry, and it belongs to the nightshade family with tomatoes and potatoes. The name comes from small white varieties that look like eggs.',
      'Its flesh is spongy and absorbs oil quickly. Salting slices for 20 minutes draws out moisture and some bitterness, so they brown instead of steaming.',
      'It features in dishes around the world, from baba ganoush and moussaka to curries and stir-fries. Smoky, charred eggplant is hard to beat.'],
    facts: 'Choose firm fruit with shiny, tight skin. Use within a few days of buying.' },
  { id: 'spinach', name: 'Spinach', color: '#3b8f4f', tag: 'A pile of leaves that shrinks to a spoonful.',
    text: ['Spinach is about 90 percent water, which is why a full pan of raw leaves cooks down to almost nothing. Buy more than you think you need.',
      'It supplies iron, folate, and vitamins A and K. The popular idea that it has far more iron than other greens came from a misplaced decimal point in an old report, but it is still a nutritious leaf.',
      'Baby spinach is tender enough for salads. Mature leaves have more flavor and suit soups, curries, and sauces.'],
    facts: 'Rinse well to remove grit. Wilt in a hot pan for under a minute.' },
  { id: 'pumpkin', name: 'Pumpkin', color: '#c9701a', tag: 'Big, sweet, and good for far more than soup.',
    text: ['Pumpkins are winter squash.  (ITEM) They grow on sprawling vines and can weigh anything from a few hundred grams to over a thousand kilos in giant-growing contests.',
      'Cooking varieties have dense, sweet orange flesh. Roast wedges with the skin on, or simmer chunks for soup, curry, or pie filling.',
      'Do not discard the seeds. Rinse, dry, toss in oil and salt, and roast until crisp for a snack.'],
    facts: 'A whole uncut pumpkin keeps for months in a cool, dry place.' }
];

// ---- 2. Grab the page elements we will work with ----
const view = document.getElementById('view');
const menu = document.getElementById('menu');
const menuBtn = document.getElementById('menuBtn');

// ---- 3. Build the menu from the VEGGIES list ----
menu.innerHTML = VEGGIES.map(v => `<a href="#${v.id}" data-id="${v.id}">${v.name}</a>`).join('');

// On phones the Menu button shows/hides the links.
menuBtn.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open);
});

// ---- 4. Helpers ----

// Escape HTML so a comment like <script>... is shown as text, never executed (prevents XSS).
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Turn an ISO date string into something readable in the visitor's locale.
const fmt = iso => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// HTML for one comment.
const commentItem = c =>
  `<li><span class="who">${esc(c.name)}</span><time datetime="${esc(c.date)}">${fmt(c.date)}</time><p>${esc(c.comment)}</p></li>`;

// Ask the server for this page's comments and show them in the list.
async function loadComments(id, list) {
  try {
    const res = await fetch('/api/comments?page=' + encodeURIComponent(id));
    const data = await res.json();
    list.innerHTML = data.length
      ? data.map(commentItem).join('')
      : '<li class="empty">No comments yet. Be the first to write one.</li>';
  } catch {
    list.innerHTML = '<li class="empty">Could not load comments. Check your connection and reload.</li>';
  }
}

// ---- 5. Draw the page that matches the URL hash ----
function render() {
  // location.hash is "#carrot", so slice(1) gives "carrot". Unknown hash -> first page.
  const id = location.hash.slice(1);
  const v = VEGGIES.find(x => x.id === id) || VEGGIES[0];

  // Re-colour the page and update the tab title.
  document.documentElement.style.setProperty('--accent', v.color);
  document.title = v.name + ' | Six Vegetables';

  // Highlight the active menu link, then close the mobile menu.
  menu.querySelectorAll('a').forEach(a => {
    if (a.dataset.id === v.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  menu.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');

  // Article + comment form + (empty) comment list.
  view.innerHTML = `
    <div class="hero"><h1>${v.name}</h1><p>${v.tag}</p></div>
    <article>
      ${v.text.map(p => `<p>${p}</p>`).join('')}
      <div class="facts"><b>Kitchen note:</b> ${v.facts}</div>
    </article>
    <h2>Leave a comment</h2>
    <form id="form" novalidate>
      <label>Name<input name="name" maxlength="60" required autocomplete="name"></label>
      <label>Comment<textarea name="comment" maxlength="1000" required></textarea></label>
      <button class="post" type="submit">Post comment</button>
      <p class="status" role="status" aria-live="polite"></p>
    </form>
    <h2>Comments</h2>
    <ul class="comments" id="list"><li class="empty">Loading comments...</li></ul>`;

  const form = document.getElementById('form');
  const list = document.getElementById('list');
  const status = form.querySelector('.status');
  const btn = form.querySelector('button');

  loadComments(v.id, list); // fetch existing comments from the server

  // When the form is submitted, send the comment to the server.
  form.addEventListener('submit', async e => {
    e.preventDefault(); // stop the browser's normal full-page form submit

    const name = form.name.value.trim();
    const comment = form.comment.value.trim();
    status.className = 'status';

    if (!name || !comment) {
      status.textContent = 'Enter your name and a comment.';
      status.classList.add('err');
      return;
    }

    btn.disabled = true; // prevent double posting
    status.textContent = 'Posting...';

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: v.id, name, comment }) // matches what server.js expects
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');

      form.comment.value = '';              // clear the comment box (keep the name)
      status.textContent = 'Comment posted.';
      status.classList.add('ok');
      loadComments(v.id, list);             // reload so the new comment appears under the article
    } catch (err) {
      status.textContent = 'Could not post: ' + err.message + ' You may be offline.';
      status.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  });

  window.scrollTo(0, 0);
}

// Redraw whenever the hash changes (menu click, back button), and once on load.
window.addEventListener('hashchange', render);
render();

// ---- 6. Register the service worker so the app is installable/offline-capable ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  console.log('Service worker registered  NOW.');
}

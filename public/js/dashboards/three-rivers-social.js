// public/js/dashboards/three-rivers-social.js
// Three Rivers Social dashboard — persistent social media post ideas

var socialCurrentFilter = 'all';
var socialGenerating = false;

// ── Sample seed posts shown before any generation ──────────────────────────

var SOCIAL_SEED_POSTS = [
  {
    id: 'seed-1',
    platform: 'instagram',
    content: "🌿 Live edge walnut perfection. This 48\" × 24\" × 2.5\" slab pulled from the yard today shows why we love working with local Connecticut timber. The natural edge tells a story — every crack and curve is original. DM us or visit Three Rivers Slab to see it in person. Limited pieces available.",
    hashtags: ['#liveedge', '#walnutslab', '#woodworking', '#liveEdgeWood', '#customFurniture', '#connecticutwood', '#slabwood', '#woodslab', '#naturalliving', '#handcrafted'],
    scheduling: 'Tuesday or Thursday, 7–9 AM or 6–8 PM',
    species: 'Walnut',
    dimensions: '48" × 24" × 2.5"',
    seeded: true
  },
  {
    id: 'seed-2',
    platform: 'facebook',
    content: "Beautiful cherry slab just arrived at Three Rivers Slab! 🍒\n\nThis 60\" × 18\" book-matched set has stunning figured grain with a warm, reddish tone that deepens beautifully with a natural oil finish. Perfect for a dining table or desk top.\n\n📐 60\" × 18\" × 2\"\n🌳 Species: Black Cherry\n📍 Location: Yard B, Row 2\n\nCherry darkens and improves with age — these pieces will only get better. Stop by to see the full collection or message us for pricing and availability.",
    hashtags: ['#cherrywood', '#bookmatched', '#woodslab', '#ThreeRiversSlab', '#customtable', '#connecticut', '#furnituremaker', '#liveedgefurniture', '#naturalwood', '#woodlover'],
    scheduling: 'Wednesday 10 AM–12 PM or Saturday 9–11 AM',
    species: 'Black Cherry',
    dimensions: '60" × 18" × 2"',
    seeded: true
  },
  {
    id: 'seed-3',
    platform: 'instagram',
    content: "Raw. Real. Ready to become something incredible. 🪵\n\nThis white oak slab is fresh from the sawmill — 72\" long, 28\" wide, 3\" thick. Sawn from a Connecticut tree with tight, straight grain and prominent ray flecks. White oak is incredibly stable and perfect for outdoor applications or food-safe surfaces.\n\nFirst come, first served. Tag a woodworker who needs this.",
    hashtags: ['#whiteoak', '#freshsawn', '#woodslab', '#oakwood', '#liveedge', '#sawmill', '#connecticutwood', '#woodshop', '#makerspace', '#slabwood'],
    scheduling: 'Friday 5–7 PM for weekend traffic',
    species: 'White Oak',
    dimensions: '72" × 28" × 3"',
    seeded: true
  }
];

// ── Entry point ─────────────────────────────────────────────────────────────

async function renderSocialDashboard(el) {
  el.innerHTML =
    '<div class="dash-header">' +
      '<div class="dash-title">Three Rivers Social</div>' +
      '<div class="dash-subtitle">Instagram &amp; Facebook Content Ideas</div>' +
    '</div>' +
    '<div class="dash-actions">' +
      '<button class="dash-btn social-generate-btn" id="socialGenerateBtn" onclick="dashSocialGenerate()">✨ Generate New Posts</button>' +
      '<button class="dash-btn" onclick="dashSocialClearSaved()">Clear Saved</button>' +
    '</div>' +
    '<div class="social-filter-bar">' +
      '<button class="social-filter-btn active" id="social-filter-all" onclick="dashSocialFilter(\'all\')">All Platforms</button>' +
      '<button class="social-filter-btn" id="social-filter-instagram" onclick="dashSocialFilter(\'instagram\')">📷 Instagram</button>' +
      '<button class="social-filter-btn" id="social-filter-facebook" onclick="dashSocialFilter(\'facebook\')">👍 Facebook</button>' +
    '</div>' +
    '<div id="social-status" class="social-status"></div>' +
    '<div id="social-posts-grid" class="social-posts-grid"><div class="dash-loading">Loading posts...</div></div>' +
    dashChatHtml('three-rivers-social-agent');

  dashSocialLoadPosts();
}

// ── Load & render posts ─────────────────────────────────────────────────────

function dashSocialLoadPosts() {
  var saved = dashSocialGetSaved();
  var posts = saved.length > 0 ? saved : SOCIAL_SEED_POSTS;
  var label = saved.length > 0 ? '' : 'Showing sample posts — generate new ones based on your live inventory.';
  dashSocialSetStatus(label, 'info');
  dashSocialRenderPosts(posts);
}

function dashSocialRenderPosts(posts) {
  var grid = document.getElementById('social-posts-grid');
  if (!grid) return;

  var filtered = socialCurrentFilter === 'all' ? posts : posts.filter(function(p) { return p.platform === socialCurrentFilter; });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="dash-empty">No ' + socialCurrentFilter + ' posts yet. Generate new ideas above.</div>';
    return;
  }

  grid.innerHTML = filtered.map(function(post) {
    var platformLabel = post.platform === 'instagram' ? '📷 Instagram' : '👍 Facebook';
    var platformClass = 'social-badge-' + post.platform;
    var isSeeded = post.seeded ? ' social-card-sample' : '';
    var hashtags = (post.hashtags || []).join(' ');

    return '<div class="social-post-card' + isSeeded + '" data-post-id="' + escapeHtml(post.id) + '">' +
      '<div class="social-card-header">' +
        '<span class="social-platform-badge ' + platformClass + '">' + platformLabel + '</span>' +
        (post.species ? '<span class="social-species-tag">' + escapeHtml(post.species) + '</span>' : '') +
        (post.dimensions ? '<span class="social-dims-tag">' + escapeHtml(post.dimensions) + '</span>' : '') +
        (post.seeded ? '<span class="social-sample-tag">Sample</span>' : '') +
      '</div>' +
      '<div class="social-card-content">' + escapeHtml(post.content) + '</div>' +
      '<div class="social-card-hashtags">' + escapeHtml(hashtags) + '</div>' +
      '<div class="social-card-scheduling">🕐 Best time: ' + escapeHtml(post.scheduling || 'Anytime') + '</div>' +
      '<div class="social-card-actions">' +
        '<button class="social-copy-btn" onclick="dashSocialCopyPost(\'' + escapeHtml(post.id) + '\')">Copy Post</button>' +
        '<button class="social-copy-btn" onclick="dashSocialCopyHashtags(\'' + escapeHtml(post.id) + '\')">Copy Hashtags</button>' +
        (!post.seeded ? '<button class="social-delete-btn" onclick="dashSocialDeletePost(\'' + escapeHtml(post.id) + '\')">✕</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  // Store posts reference for copy actions
  window._socialPostsCache = posts;
}

// ── Generate new posts ──────────────────────────────────────────────────────

async function dashSocialGenerate() {
  if (socialGenerating) return;
  socialGenerating = true;

  var btn = document.getElementById('socialGenerateBtn');
  if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }
  dashSocialSetStatus('Asking the social agent to generate post ideas...', 'info');

  try {
    var resp = await fetch('/agents/three-rivers-social-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: 'Generate 3 engaging social media posts for Three Rivers Slab — one Instagram post and two Facebook posts. Use any current slab inventory data available. If inventory is empty, create sample posts featuring typical Connecticut hardwood species (walnut, cherry, white oak). Include dimensions, hashtags, and best posting times.',
        context: {}
      }),
      signal: AbortSignal.timeout(60000)
    });

    var data = await resp.json();
    if (data.output) {
      var parsed = dashSocialParseOutput(data.output);
      if (parsed.length > 0) {
        var existing = dashSocialGetSaved();
        var merged = parsed.concat(existing).slice(0, 12); // keep max 12
        dashSocialSave(merged);
        dashSocialRenderPosts(merged);
        dashSocialSetStatus('✅ ' + parsed.length + ' new post idea(s) generated and saved.', 'success');
      } else {
        // Agent returned text but couldn't parse structured posts — show raw output in chat
        var chatOut = document.getElementById('dashChatOutput');
        if (chatOut) {
          chatOut.innerHTML = '<div class="dash-chat-response"><strong>Generated content:</strong><br>' + escapeHtml(data.output) + '</div>';
        }
        dashSocialSetStatus('Posts generated — see chat output below. Use "Copy Post" after formatting.', 'info');
      }
    } else {
      dashSocialSetStatus('⚠️ Agent returned no output. Try again or check agent status.', 'error');
    }
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      dashSocialSetStatus('⚠️ Generation timed out (60s). Try a more specific request in the chat below.', 'error');
    } else {
      dashSocialSetStatus('⚠️ Error: ' + e.message, 'error');
    }
  } finally {
    socialGenerating = false;
    if (btn) { btn.textContent = '✨ Generate New Posts'; btn.disabled = false; }
  }
}

// ── Parse agent output into structured post objects ─────────────────────────

function dashSocialParseOutput(text) {
  var posts = [];
  var id = Date.now();

  // Split on "DRAFT POST FOR" sections
  var sections = text.split(/DRAFT POST FOR/i).filter(function(s) { return s.trim().length > 50; });

  sections.forEach(function(section, idx) {
    var platform = 'instagram';
    if (/facebook/i.test(section)) platform = 'facebook';

    // Extract hashtags line
    var hashtagMatch = section.match(/#+\w[\w#\s]*/g);
    var hashtags = hashtagMatch ? hashtagMatch[0].trim().split(/\s+/) : [];

    // Extract scheduling recommendation
    var schedMatch = section.match(/scheduling recommendation[:\s]+([^\n]+)/i);
    var scheduling = schedMatch ? schedMatch[1].trim() : 'Anytime';

    // Extract species/dimensions if present
    var speciesMatch = section.match(/species[:\s]+([^\n,]+)/i);
    var dimMatch = section.match(/(\d+["']\s*[×x]\s*\d+["']\s*[×x]\s*[\d.]+["'])/i);

    // Extract post body (between header and HASHTAGS:)
    var bodyMatch = section.match(/[A-Z]+:?\s*\n([\s\S]+?)(?:HASHTAGS:|SCHEDULING:|INVENTORY:|POST VARIATION|$)/i);
    var content = bodyMatch ? bodyMatch[1].trim() : section.slice(0, 400).trim();

    if (content.length > 30) {
      posts.push({
        id: 'gen-' + id + '-' + idx,
        platform: platform,
        content: content,
        hashtags: hashtags,
        scheduling: scheduling,
        species: speciesMatch ? speciesMatch[1].trim() : null,
        dimensions: dimMatch ? dimMatch[1] : null,
        seeded: false,
        generated_at: new Date().toISOString()
      });
    }
  });

  // Fallback: if no sections parsed, treat whole output as one post
  if (posts.length === 0 && text.length > 50) {
    var platform = /facebook/i.test(text) ? 'facebook' : 'instagram';
    posts.push({
      id: 'gen-' + id + '-0',
      platform: platform,
      content: text.slice(0, 600),
      hashtags: [],
      scheduling: 'Anytime',
      species: null,
      dimensions: null,
      seeded: false,
      generated_at: new Date().toISOString()
    });
  }

  return posts;
}

// ── Filter ──────────────────────────────────────────────────────────────────

function dashSocialFilter(platform) {
  socialCurrentFilter = platform;
  ['all', 'instagram', 'facebook'].forEach(function(p) {
    var btn = document.getElementById('social-filter-' + p);
    if (btn) btn.classList.toggle('active', p === platform);
  });
  var saved = dashSocialGetSaved();
  var posts = saved.length > 0 ? saved : SOCIAL_SEED_POSTS;
  dashSocialRenderPosts(posts);
}

// ── Copy helpers ────────────────────────────────────────────────────────────

function dashSocialCopyPost(postId) {
  var post = (window._socialPostsCache || []).find(function(p) { return p.id === postId; });
  if (!post) return;
  var text = post.content + '\n\n' + (post.hashtags || []).join(' ');
  navigator.clipboard.writeText(text).then(function() {
    dashSocialSetStatus('✅ Post copied to clipboard!', 'success');
  }).catch(function() {
    dashSocialSetStatus('Copy failed — try selecting and copying manually.', 'error');
  });
}

function dashSocialCopyHashtags(postId) {
  var post = (window._socialPostsCache || []).find(function(p) { return p.id === postId; });
  if (!post) return;
  navigator.clipboard.writeText((post.hashtags || []).join(' ')).then(function() {
    dashSocialSetStatus('✅ Hashtags copied!', 'success');
  });
}

function dashSocialDeletePost(postId) {
  var saved = dashSocialGetSaved().filter(function(p) { return p.id !== postId; });
  dashSocialSave(saved);
  var posts = saved.length > 0 ? saved : SOCIAL_SEED_POSTS;
  dashSocialRenderPosts(posts);
}

function dashSocialClearSaved() {
  if (!confirm('Clear all saved posts? Sample posts will remain.')) return;
  localStorage.removeItem('lifebridge-social-posts');
  dashSocialLoadPosts();
  dashSocialSetStatus('Saved posts cleared.', 'info');
}

// ── Persistence (localStorage) ──────────────────────────────────────────────

function dashSocialGetSaved() {
  try {
    return JSON.parse(localStorage.getItem('lifebridge-social-posts') || '[]');
  } catch(e) { return []; }
}

function dashSocialSave(posts) {
  localStorage.setItem('lifebridge-social-posts', JSON.stringify(posts));
}

// ── Status bar ──────────────────────────────────────────────────────────────

function dashSocialSetStatus(msg, type) {
  var el = document.getElementById('social-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'social-status social-status-' + (type || 'info');
  if (type === 'success') {
    setTimeout(function() {
      if (el.textContent === msg) el.textContent = '';
    }, 4000);
  }
}

window.renderSocialDashboard = renderSocialDashboard;

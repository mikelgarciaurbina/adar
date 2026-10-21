// A deliberately small Markdown renderer for the project's own files (ROADMAP.md, release notes).
// Everything is escaped first, so the output only contains the tags produced here.

// Release notes sometimes carry entities already (`&lt;current&gt;`): decode those before escaping.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" };
const escape = (s) => s.replace(/&(lt|gt|amp|quot|#39);/g, (_, e) => ENTITIES[e])
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(text) {
  const codes = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const url = /^(https?:|#|\.{0,2}\/|[\w-]+\.(md|html)\b)/.test(href) ? href : '#';
      const abs = /^[\w-]+\.md\b/.test(url) ? `https://github.com/mikelgarciaurbina/adar/blob/main/${url}` : url;
      return `<a href="${abs}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,:;!?]|$)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function render(md) {
  const out = [];
  let list = null, para = [], code = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    if (code) {
      if (/^```/.test(raw)) { out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw);
      continue;
    }
    if (/^```/.test(raw)) { flushPara(); flushList(); code = []; continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara(); flushList();
      out.push(`<h4 data-h="${h[2].toLowerCase().replace(/[^a-z]+/g, '-')}">${inline(h[2])}</h4>`);
      continue;
    }
    const li = raw.match(/^\s*[-*]\s+(.*)/);
    if (li) { flushPara(); (list ??= []).push(li[1]); continue; }
    if (!raw.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(raw)) { list[list.length - 1] += ` ${raw.trim()}`; continue; }
    flushList();
    para.push(raw.trim());
  }
  if (code) out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
  flushPara();
  flushList();
  return out.join('');
}

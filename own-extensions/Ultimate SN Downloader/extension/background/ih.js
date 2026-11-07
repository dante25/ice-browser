/* Image Host Grabber engine (the host file of ImageHostGrabber 1.7.0.6, same semantics):
   <host id=".."><urlpattern>regex of the LINK</urlpattern><searchpattern>how to get the image from that link's page</searchpattern></host>
   searchpattern is either a function(pageData, pageUrl) -> {imgUrl, fileName?, referer?, status: OK|ABORT|RETRY|REQUEUE|REDIRECT}
   (run in a sandboxed page) or a string: "LINK2FILE"/"Embedded Image" (the link is the image), "ID: <img id>", "REPLACE: 'regex','replacement'",
   or a regex that is tested against the page's <img> tags. */

const xmlUnescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cdata = s => { s = s.trim(); const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/); return m ? m[1] : xmlUnescape(s); };

export function parseHostFile(text) {
  const hosts = [], re = /<host\b([^>]*)>([\s\S]*?)<\/host>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1], body = m[2];
    const id = (attrs.match(/\bid="([^"]*)"/) || [])[1] || '';
    const up = body.match(/<urlpattern\b([^>]*)>([\s\S]*?)<\/urlpattern>/), sp = body.match(/<searchpattern\b[^>]*>([\s\S]*?)<\/searchpattern>/);
    if (!up || !sp || id === '.') continue;                       // id="." is the file's own update record
    hosts.push({ id, url: cdata(up[2]), sp: cdata(sp[1]), post: (up[1].match(/POSTData="([^"]*)"/) || [])[1] || '',
      maxThreads: Number((attrs.match(/maxThreads="(\d+)"/) || [])[1] || 0) });
  }
  return hosts;
}

let compiled = null;
export function setHosts(hosts) {
  compiled = [];
  for (const h of hosts) { try { compiled.push({ ...h, re: new RegExp(h.url, 'i') }); } catch (e) { /* a broken pattern is skipped */ } }
  return compiled.length;
}
export const hostCount = () => (compiled ? compiled.length : 0);

export function matchRule(link) {
  if (!compiled) return null;
  for (const h of compiled) if (h.re.test(link)) return h;
  return null;
}

const IMG_EXT = /^https?:\/\/[^/]+\/[^?#]+\.(?:bmp|dib|gif|ico|jp(?:eg|[eg])|png|tiff?|webp|avif)(?:[?#].*)?$/i;
export const isDirectImage = u => IMG_EXT.test(u);

// ---- the string forms
const imgTags = text => text.replace(/\r?\n/g, ' ').match(/<img\b.+?>/ig) || [];
const srcOf = tag => { const m = tag.match(/\bsrc\s*=\s*("|')?(.+?)\1(?=\s|\/?>)/i); return m ? m[2].replace(/&amp;/ig, '&') : null; };

function fromId(text, id) {
  let found = null;
  for (const tag of imgTags(text)) {
    const a = tag.match(/\bid\s*=\s*("|')?(.+?)\1(?=\s|\/?>)/i);
    if (a && (a[2] === id || new RegExp('^(?:' + id + ')$').test(a[2]))) { const s = srcOf(tag); if (s) found = s; }
  }
  return found;
}
function fromRegex(text, pattern) {
  let re; try { re = new RegExp(pattern); } catch (e) { return null; }
  let url = null;
  for (const tag of imgTags(text).filter(t => re.test(t))) { const s = srcOf(tag); if (s) url = s; }
  return url;
}
const absolute = (u, base) => { try { return new URL(u, base).href; } catch (e) { return u; } };

// string rules that need the page text: returns the image url or null
export function runStringRule(sp, link, pageText, pageUrl) {
  const pat = sp.replace(/^"(.*)"$/, '$1').replace(/\\\\/g, '\\');
  if (/^(?:Embedded Image|LINK2FILE)$/.test(pat)) return link;
  if (/^REPLACE: /.test(pat)) {
    const m = pat.match(/REPLACE: ('|")(.*)\1.*,.*('|")(.*)\3/);
    return m ? link.replace(new RegExp(m[2]), m[4]) : null;
  }
  let u = null;
  if (/^ID: .+/.test(pat)) u = fromId(pageText, pat.match(/ID: (.+)/)[1]);
  else u = fromRegex(pageText, pat);
  return u ? absolute(u, pageUrl) : null;
}
export const needsPage = sp => { const pat = sp.replace(/^"(.*)"$/, '$1'); return !/^(?:Embedded Image|LINK2FILE|REPLACE: )/.test(pat); };
export const isFunctionRule = sp => /^function/.test(sp.trim());
export const baseName = u => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch (e) { return ''; } };

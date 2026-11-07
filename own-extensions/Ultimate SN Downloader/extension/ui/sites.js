/* Sites the extension knows (UI side). Add a site here + content/<site>.js + background/sites list. */
var SITES = {
  ig: { name: 'Instagram', badge: 'IG', url: /^https:\/\/www\.instagram\.com\// },
  fb: { name: 'Facebook',  badge: 'FB', url: /^https:\/\/(www|web)\.facebook\.com\// },
  x:  { name: 'X',         badge: 'X',  url: /^https:\/\/(www\.)?(x|twitter)\.com\// },
  da: { name: 'DeviantArt', badge: 'DA', url: /^https:\/\/www\.deviantart\.com\// },
  fl: { name: 'Flickr',    badge: 'FL', url: /^https:\/\/www\.flickr\.com\// },
  ih: { name: 'Image Host Grabber', badge: 'IH', url: /^https?:\/\// }
};
function siteOfUrl(u) { for (var k in SITES) if (SITES[k].url.test(u || '')) return k; return ''; }
